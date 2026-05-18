import type { ActionCtx, MutationCtx } from "./_generated/server"
import type { GenericId } from "convex/values"

import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction, internalMutation } from "./_generated/server"
import { getProviderEnv } from "./lib/env"
import { embedDocumentTexts, estimateJinaEmbeddingRequestCount, JINA_DOCUMENT_PREFIX, JINA_EMBEDDING_PROVIDER } from "./lib/jina"
import {
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./lib/providerErrors"
import { buildProviderKeyPool, resolveProviderKey } from "./lib/providerKeys"

const DEFAULT_EMBEDDING_BATCH_SIZE = 50
const PROCESSING_BATCH_LEASE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000
const TRANSIENT_RETRY_AFTER_MS = 5_000

const RATE_LIMITED_BATCH_MESSAGE = "Embedding provider capacity is temporarily unavailable. The batch will retry automatically."
const RETRYING_BATCH_MESSAGE = "Embedding provider failed transiently. The batch will retry automatically."
const FAILED_BATCH_MESSAGE = "Embedding provider failed permanently. Operator intervention is required."
const STALE_BATCH_MESSAGE = "Embedding batch no longer matches current document chunks. The ingestion job has been failed."

const claimNextBatchResultValidator = v.union(
  v.null(),
  v.object({
    attemptCount: v.number(),
    batchId: v.id("embeddingBatches"),
    chunkIds: v.array(v.id("chunks")),
    contents: v.array(v.string())
  })
)

type ClaimedBatch = {
  attemptCount: number
  batchId: GenericId<"embeddingBatches">
  chunkIds: GenericId<"chunks">[]
  contents: string[]
}

type ProviderReservation = { available: true; keyId: string } | { available: false; retryAfterMs: number }

type JobRef = {
  _creationTime: number
  _id: GenericId<"ingestionJobs">
  createdAt: number
  documentId: GenericId<"documents">
}

function canApplyClaimedAttempt(batch: { attemptCount: number; status: string }, attemptCount: number) {
  return batch.status === "processing" && batch.attemptCount === attemptCount
}

function compareJobRecency(left: JobRef, right: JobRef) {
  if (left._creationTime !== right._creationTime) {
    return left._creationTime - right._creationTime
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  return String(left._id).localeCompare(String(right._id))
}

function getBatchSize(batchSize: number | undefined) {
  const parsed = Math.floor(batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE)
  return parsed > 0 ? parsed : DEFAULT_EMBEDDING_BATCH_SIZE
}

function getRetryAfterMs(value: number | undefined, fallback = DEFAULT_RATE_LIMIT_RETRY_AFTER_MS) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

function estimateInputTokens(contents: string[]) {
  return contents.reduce((total, content) => total + Math.max(1, Math.ceil(content.length / 4)), 0)
}

function isClaimableBatch(batch: { nextRunAt?: number; status: string; updatedAt: number }, now: number) {
  if (batch.status === "processing") {
    return batch.updatedAt < now - PROCESSING_BATCH_LEASE_TIMEOUT_MS
  }

  return (
    (batch.status === "pending" || batch.status === "retrying" || batch.status === "rate_limited") &&
    (batch.nextRunAt === undefined || batch.nextRunAt <= now)
  )
}

async function allChunksHaveCurrentEmbeddings(ctx: Pick<MutationCtx, "db">, chunkIds: GenericId<"chunks">[]) {
  for (const chunkId of chunkIds) {
    const currentEmbeddings = await ctx.db
      .query("chunkEmbeddings")
      .withIndex("by_chunk", (q) => q.eq("chunkId", chunkId))
      .collect()
    if (!currentEmbeddings.some((embedding) => embedding.isCurrent)) {
      return false
    }
  }

  return chunkIds.length > 0
}

async function completeJobIfAllBatchesDoneInMutation(
  ctx: MutationCtx,
  args: { documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs"> }
) {
  const batches = await ctx.db
    .query("embeddingBatches")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .collect()
  const jobBatches = batches.filter((batch) => batch.documentId === args.documentId)
  if (
    jobBatches.length === 0 ||
    jobBatches.some((batch) => batch.status !== "completed") ||
    jobBatches.some((batch) => batch.finalizedAt !== undefined)
  ) {
    return false
  }

  const job = await ctx.db.get("ingestionJobs", args.jobId)
  if (job?.status === "embedding_waiting_rate_limit") {
    await ctx.db.patch("ingestionJobs", args.jobId, {
      status: "embedding",
      updatedAt: Date.now()
    })
  }

  await ctx.scheduler.runAfter(0, internal.search.backfillDocumentExactTermsBatch, {
    documentId: args.documentId,
    jobId: args.jobId,
    offset: 0,
    phase: "cleanup"
  })
  const now = Date.now()
  await ctx.db.patch("embeddingBatches", jobBatches[0]._id, { finalizedAt: now, updatedAt: now })
  return true
}

async function markInvalidBatchFailed(
  ctx: MutationCtx,
  args: { batchId: GenericId<"embeddingBatches">; documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs"> },
  now: number
) {
  await ctx.db.patch("embeddingBatches", args.batchId, {
    lastErrorMessage: STALE_BATCH_MESSAGE,
    nextRunAt: undefined,
    status: "failed",
    updatedAt: now
  })

  await ctx.db.patch("ingestionJobs", args.jobId, {
    errorMessage: STALE_BATCH_MESSAGE,
    status: "failed",
    updatedAt: now
  })

  const documentJobs = await ctx.db
    .query("ingestionJobs")
    .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
    .collect()
  const latestDocumentJob = documentJobs.reduce<JobRef | null>((latest, candidate) => {
    if (!latest || compareJobRecency(candidate, latest) > 0) {
      return candidate
    }

    return latest
  }, null)

  if (latestDocumentJob?._id === args.jobId) {
    await ctx.db.patch("documents", args.documentId, {
      status: "failed",
      updatedAt: now
    })
  }
}

async function getCurrentBatchContents(
  ctx: Pick<MutationCtx, "db">,
  args: { documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs"> },
  chunkIds: GenericId<"chunks">[]
) {
  const contents: string[] = []
  for (const chunkId of chunkIds) {
    const chunk = await ctx.db.get(chunkId)
    if (!chunk?.isCurrent || chunk.documentId !== args.documentId || chunk.ingestionJobId !== args.jobId) {
      return null
    }
    contents.push(chunk.content)
  }

  return contents
}

async function scheduleProcessNextBatch(
  ctx: Pick<ActionCtx, "scheduler"> | Pick<MutationCtx, "scheduler">,
  args: { documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs"> },
  delayMs: number
) {
  await ctx.scheduler.runAfter(Math.max(0, delayMs), internal.embeddingBatches.processNextBatch, {
    documentId: args.documentId,
    jobId: args.jobId
  })
}

async function failClaimedBatch(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    attemptCount: number
    batchId: GenericId<"embeddingBatches">
    documentId: GenericId<"documents">
    jobId: GenericId<"ingestionJobs">
    keyId?: string
  }
) {
  await ctx.runMutation(internal.embeddingBatches.markBatchFailed, {
    attemptCount: args.attemptCount,
    batchId: args.batchId,
    documentId: args.documentId,
    jobId: args.jobId,
    ...(args.keyId === undefined ? {} : { lastProviderKeyId: args.keyId })
  })
}

async function releaseReservedProviderKey(ctx: Pick<ActionCtx, "runMutation">, keyId: string) {
  await ctx.runMutation(internal.providerRateLimits.recordProviderTransientFailure, {
    keyId,
    provider: JINA_EMBEDDING_PROVIDER
  })
}

async function retryClaimedBatch(
  ctx: Pick<ActionCtx, "runMutation">,
  args: { attemptCount: number; batchId: GenericId<"embeddingBatches">; keyId?: string }
) {
  await ctx.runMutation(internal.embeddingBatches.markBatchRetrying, {
    attemptCount: args.attemptCount,
    batchId: args.batchId,
    ...(args.keyId === undefined ? {} : { lastProviderKeyId: args.keyId }),
    retryAfterMs: TRANSIENT_RETRY_AFTER_MS
  })
}

export const createBatchesForJob = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    chunkIds: v.array(v.id("chunks")),
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs")
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const existingBatches = await ctx.db
      .query("embeddingBatches")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(1)
    if (existingBatches.length > 0) {
      await scheduleProcessNextBatch(ctx, args, 0)
      return 0
    }

    const now = Date.now()
    const batchSize = getBatchSize(args.batchSize)
    let inserted = 0

    for (let offset = 0; offset < args.chunkIds.length; offset += batchSize) {
      await ctx.db.insert("embeddingBatches", {
        attemptCount: 0,
        batchIndex: inserted,
        chunkIds: args.chunkIds.slice(offset, offset + batchSize),
        createdAt: now,
        documentId: args.documentId,
        jobId: args.jobId,
        status: "pending",
        updatedAt: now
      })
      inserted += 1
    }

    if (inserted > 0) {
      await scheduleProcessNextBatch(ctx, args, 0)
    }

    return inserted
  }
})

export const claimNextBatch = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs")
  },
  returns: claimNextBatchResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now()
    const job = await ctx.db.get(args.jobId)
    if (
      !job ||
      job.documentId !== args.documentId ||
      (job.status !== "embedding" && job.status !== "embedding_waiting_rate_limit")
    ) {
      return null
    }

    const document = await ctx.db.get(args.documentId)
    if (!document || document.status !== "processing") {
      return null
    }

    const batches = await ctx.db
      .query("embeddingBatches")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect()
    const candidates = batches
      .filter((candidate) => {
        return candidate.documentId === args.documentId && isClaimableBatch(candidate, now)
      })
      .sort((left, right) => left.batchIndex - right.batchIndex)

    let batch: (typeof candidates)[number] | undefined = candidates[0]
    let contents: string[] | null = null
    let completedAlreadyEmbeddedBatch = false
    while (batch) {
      contents = await getCurrentBatchContents(ctx, args, batch.chunkIds)
      if (!contents) {
        await markInvalidBatchFailed(ctx, { batchId: batch._id, documentId: args.documentId, jobId: args.jobId }, now)
        return null
      }

      if (!(await allChunksHaveCurrentEmbeddings(ctx, batch.chunkIds))) {
        break
      }

      const completedBatchIndex: number = batch.batchIndex
      await ctx.db.patch("embeddingBatches", batch._id, {
        lastErrorMessage: undefined,
        nextRunAt: undefined,
        status: "completed",
        updatedAt: now
      })
      completedAlreadyEmbeddedBatch = true
      batch = candidates.find((candidate) => candidate.batchIndex > completedBatchIndex)
      contents = null
    }

    if (!batch) {
      if (completedAlreadyEmbeddedBatch) {
        await completeJobIfAllBatchesDoneInMutation(ctx, args)
      }
      return null
    }

    const attemptCount = batch.attemptCount + 1
    await ctx.db.patch("embeddingBatches", batch._id, {
      attemptCount,
      nextRunAt: undefined,
      status: "processing",
      updatedAt: now
    })
    await scheduleProcessNextBatch(ctx, args, PROCESSING_BATCH_LEASE_TIMEOUT_MS + 1)

    if (!contents) {
      return null
    }

    return {
      attemptCount,
      batchId: batch._id,
      chunkIds: batch.chunkIds,
      contents
    }
  }
})

export const markBatchCompleted = internalMutation({
  args: { attemptCount: v.number(), batchId: v.id("embeddingBatches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId)
    if (!batch) {
      return null
    }
    if (!canApplyClaimedAttempt(batch, args.attemptCount)) {
      return null
    }

    await ctx.db.patch("embeddingBatches", args.batchId, {
      lastErrorMessage: undefined,
      nextRunAt: undefined,
      status: "completed",
      updatedAt: Date.now()
    })
    const completed = await completeJobIfAllBatchesDoneInMutation(ctx, {
      documentId: batch.documentId,
      jobId: batch.jobId
    })
    if (!completed) {
      await scheduleProcessNextBatch(ctx, { documentId: batch.documentId, jobId: batch.jobId }, 0)
    }
    return null
  }
})

export const markBatchRateLimited = internalMutation({
  args: {
    attemptCount: v.number(),
    batchId: v.id("embeddingBatches"),
    jobId: v.id("ingestionJobs"),
    lastProviderKeyId: v.optional(v.string()),
    retryAfterMs: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const batch = await ctx.db.get(args.batchId)
    if (!batch) {
      return null
    }
    if (!canApplyClaimedAttempt(batch, args.attemptCount)) {
      return null
    }
    const retryAfterMs = getRetryAfterMs(args.retryAfterMs)

    await ctx.db.patch("embeddingBatches", args.batchId, {
      lastErrorMessage: RATE_LIMITED_BATCH_MESSAGE,
      ...(args.lastProviderKeyId === undefined ? {} : { lastProviderKeyId: args.lastProviderKeyId }),
      nextRunAt: now + retryAfterMs,
      status: "rate_limited",
      updatedAt: now
    })

    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (job?.status === "embedding") {
      await ctx.db.patch("ingestionJobs", args.jobId, {
        status: "embedding_waiting_rate_limit",
        updatedAt: now
      })
    }

    await scheduleProcessNextBatch(ctx, { documentId: batch.documentId, jobId: batch.jobId }, retryAfterMs)
    return null
  }
})

export const markBatchRetrying = internalMutation({
  args: {
    attemptCount: v.number(),
    batchId: v.id("embeddingBatches"),
    lastProviderKeyId: v.optional(v.string()),
    retryAfterMs: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const batch = await ctx.db.get(args.batchId)
    if (!batch) {
      return null
    }
    if (!canApplyClaimedAttempt(batch, args.attemptCount)) {
      return null
    }
    const retryAfterMs = Math.max(0, Math.floor(args.retryAfterMs))

    await ctx.db.patch("embeddingBatches", args.batchId, {
      lastErrorMessage: RETRYING_BATCH_MESSAGE,
      ...(args.lastProviderKeyId === undefined ? {} : { lastProviderKeyId: args.lastProviderKeyId }),
      nextRunAt: now + retryAfterMs,
      status: "retrying",
      updatedAt: now
    })
    await scheduleProcessNextBatch(ctx, { documentId: batch.documentId, jobId: batch.jobId }, retryAfterMs)
    return null
  }
})

export const markBatchFailed = internalMutation({
  args: {
    attemptCount: v.number(),
    batchId: v.id("embeddingBatches"),
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs"),
    lastProviderKeyId: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId)
    if (!batch || !canApplyClaimedAttempt(batch, args.attemptCount)) {
      return null
    }

    await ctx.db.patch("embeddingBatches", args.batchId, {
      lastErrorMessage: FAILED_BATCH_MESSAGE,
      ...(args.lastProviderKeyId === undefined ? {} : { lastProviderKeyId: args.lastProviderKeyId }),
      nextRunAt: undefined,
      status: "failed",
      updatedAt: Date.now()
    })
    await ctx.runMutation(internal.documents.markFailed, {
      documentId: args.documentId,
      errorMessage: FAILED_BATCH_MESSAGE,
      jobId: args.jobId
    })
    return null
  }
})

export const completeJobIfAllBatchesDone = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs")
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await completeJobIfAllBatchesDoneInMutation(ctx, args)
  }
})

export const processNextBatch = internalAction({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs")
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const batch = (await ctx.runMutation(internal.embeddingBatches.claimNextBatch, args)) as ClaimedBatch | null
    if (!batch) {
      await ctx.runMutation(internal.embeddingBatches.completeJobIfAllBatchesDone, args)
      return null
    }

    let env: ReturnType<typeof getProviderEnv>
    try {
      env = getProviderEnv()
    } catch {
      await failClaimedBatch(ctx, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        documentId: args.documentId,
        jobId: args.jobId
      })
      return null
    }

    let keyPool: ReturnType<typeof buildProviderKeyPool>
    try {
      keyPool = buildProviderKeyPool(JINA_EMBEDDING_PROVIDER, env.jinaApiKeys)
    } catch {
      await failClaimedBatch(ctx, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        documentId: args.documentId,
        jobId: args.jobId
      })
      return null
    }

    const estimatedInputTokens = estimateInputTokens(batch.contents)
    const estimatedRequestCount = estimateJinaEmbeddingRequestCount(batch.contents, JINA_DOCUMENT_PREFIX)
    let reservation: ProviderReservation
    try {
      reservation = (await ctx.runMutation(internal.providerRateLimits.reserveProviderKey, {
        estimatedInputTokens,
        estimatedOutputTokens: 0,
        estimatedRequestCount,
        inputTpmLimit: env.jinaTpmPerKey,
        keyIds: keyPool.map((key) => key.id),
        maxConcurrent: env.jinaMaxConcurrentPerKey,
        outputTpmLimit: env.jinaTpmPerKey,
        provider: JINA_EMBEDDING_PROVIDER,
        rpmLimit: env.jinaRpmPerKey
      })) as ProviderReservation
    } catch {
      await retryClaimedBatch(ctx, { attemptCount: batch.attemptCount, batchId: batch.batchId })
      return null
    }

    if (!reservation.available) {
      const retryAfterMs = getRetryAfterMs(reservation.retryAfterMs)
      await ctx.runMutation(internal.embeddingBatches.markBatchRateLimited, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        jobId: args.jobId,
        retryAfterMs
      })
      return null
    }

    let apiKey: string
    try {
      apiKey = resolveProviderKey(keyPool, reservation.keyId)
    } catch {
      await releaseReservedProviderKey(ctx, reservation.keyId)
      await failClaimedBatch(ctx, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        documentId: args.documentId,
        jobId: args.jobId,
        keyId: reservation.keyId
      })
      return null
    }

    let embeddings: number[][]
    try {
      embeddings = await embedDocumentTexts(batch.contents, {
        apiKey,
        keyId: reservation.keyId,
        model: env.jinaEmbedModel
      })
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        const retryAfterMs = getRetryAfterMs(error.retryAfterMs)
        await ctx.runMutation(internal.providerRateLimits.recordProviderRateLimit, {
          keyId: error.keyId,
          provider: JINA_EMBEDDING_PROVIDER,
          retryAfterMs
        })
        await ctx.runMutation(internal.embeddingBatches.markBatchRateLimited, {
          attemptCount: batch.attemptCount,
          batchId: batch.batchId,
          jobId: args.jobId,
          lastProviderKeyId: error.keyId,
          retryAfterMs
        })
        return null
      }

      if (error instanceof ProviderQuotaExhaustedError) {
        await ctx.runMutation(internal.providerRateLimits.disableProviderKey, {
          keyId: error.keyId,
          provider: JINA_EMBEDDING_PROVIDER,
          reason: "quota_exhausted"
        })
        await ctx.runMutation(internal.embeddingBatches.markBatchRetrying, {
          attemptCount: batch.attemptCount,
          batchId: batch.batchId,
          lastProviderKeyId: error.keyId,
          retryAfterMs: 0
        })
        return null
      }

      if (error instanceof ProviderTransientError) {
        const keyId = error.keyId ?? reservation.keyId
        await ctx.runMutation(internal.providerRateLimits.recordProviderTransientFailure, {
          keyId,
          provider: JINA_EMBEDDING_PROVIDER
        })
        await ctx.runMutation(internal.embeddingBatches.markBatchRetrying, {
          attemptCount: batch.attemptCount,
          batchId: batch.batchId,
          lastProviderKeyId: keyId,
          retryAfterMs: TRANSIENT_RETRY_AFTER_MS
        })
        return null
      }

      await releaseReservedProviderKey(ctx, reservation.keyId)
      await failClaimedBatch(ctx, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        documentId: args.documentId,
        jobId: args.jobId,
        keyId: error instanceof ProviderPermanentError ? (error.keyId ?? reservation.keyId) : reservation.keyId
      })
      return null
    }

    let providerSuccessRecorded = false
    let embeddingsPersisted = false
    try {
      await ctx.runMutation(internal.providerRateLimits.recordProviderSuccess, {
        keyId: reservation.keyId,
        provider: JINA_EMBEDDING_PROVIDER
      })
      providerSuccessRecorded = true
      await ctx.runMutation(internal.documents.insertChunkEmbeddingsBatch, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        chunkIds: batch.chunkIds,
        embeddingModel: env.jinaEmbedModel,
        embeddings,
        jobId: args.jobId
      })
      embeddingsPersisted = true
      await ctx.runMutation(internal.embeddingBatches.markBatchCompleted, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId
      })
      return null
    } catch {
      if (!providerSuccessRecorded) {
        await releaseReservedProviderKey(ctx, reservation.keyId)
      }

      if (embeddingsPersisted) {
        await retryClaimedBatch(ctx, {
          attemptCount: batch.attemptCount,
          batchId: batch.batchId,
          keyId: reservation.keyId
        })
        return null
      }

      await retryClaimedBatch(ctx, {
        attemptCount: batch.attemptCount,
        batchId: batch.batchId,
        keyId: reservation.keyId
      })
      return null
    }
  }
})
