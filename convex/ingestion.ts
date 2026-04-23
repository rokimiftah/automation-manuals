import type { Id } from "./_generated/dataModel"
import type { IngestionStatus } from "./lib/ingestionState"

import { ConvexError, v } from "convex/values"

import { unzipSync } from "fflate"

import { internal } from "./_generated/api"
import { httpAction, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireAdminQuerySession, requireAdminWriteSession } from "./lib/adminSession"
import { getProviderEnv } from "./lib/env"
import { buildDocumentPayload } from "./lib/ingestDocument"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { getMineruBatchResult, mapMineruBatchState, submitMineruBatch } from "./lib/mineru"
import { verifyMineruChecksum } from "./lib/mineruCallback"
import {
  buildProviderProgressPatch,
  getProviderFailureMessage,
  getProviderReconcileDecision
} from "./lib/providerRetry"
import { normalizeMineruDocument } from "./lib/mineruResult"
import { embedTexts, ocrPdfPage } from "./lib/mistral"
import { ingestionStatusValidator } from "./lib/validators"

const listJobValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("ingestionJobs"),
  createdAt: v.number(),
  documentId: v.id("documents"),
  errorMessage: v.optional(v.string()),
  providerErrorCode: v.optional(v.number()),
  providerErrorMessage: v.optional(v.string()),
  providerLastCheckedAt: v.optional(v.number()),
  providerState: v.optional(v.string()),
  status: ingestionStatusValidator
})

const jobByIdValidator = v.union(
  v.null(),
  v.object({
    _creationTime: v.number(),
    _id: v.id("ingestionJobs"),
    createdAt: v.number(),
    documentId: v.id("documents"),
    errorMessage: v.optional(v.string()),
    priorityQuotaBucket: v.optional(
      v.union(v.literal("priority_expected"), v.literal("standard_possible"), v.literal("unknown"))
    ),
    provider: v.optional(v.literal("mineru")),
    providerBatchId: v.optional(v.string()),
    providerCallbackVerifiedAt: v.optional(v.number()),
    providerDataId: v.optional(v.string()),
    providerErrorCode: v.optional(v.number()),
    providerErrorMessage: v.optional(v.string()),
    providerLastCheckedAt: v.optional(v.number()),
    providerReconcileFailureCount: v.optional(v.number()),
    providerResultUrl: v.optional(v.string()),
    providerState: v.optional(v.string()),
    providerSubmittedAt: v.optional(v.number()),
    providerTraceId: v.optional(v.string()),
    requestedByAdmin: v.string(),
    sourceFileName: v.optional(v.string()),
    sourceMimeType: v.optional(v.string()),
    sourceStorageId: v.optional(v.id("_storage")),
    status: ingestionStatusValidator,
    updatedAt: v.number()
  })
)

type RetryableIngestionJob = {
  _creationTime: number
  _id: Id<"ingestionJobs">
  createdAt: number
  documentId: Id<"documents">
  status: IngestionStatus
}

function compareJobRecency(left: RetryableIngestionJob, right: RetryableIngestionJob) {
  if (left._creationTime !== right._creationTime) {
    return left._creationTime - right._creationTime
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  return String(left._id).localeCompare(String(right._id))
}

export function isRetryableJob(job: RetryableIngestionJob, jobs: RetryableIngestionJob[]) {
  if (job.status !== "failed") {
    return false
  }

  const latestDocumentJob = jobs.reduce<RetryableIngestionJob | null>((latest, candidate) => {
    if (candidate.documentId !== job.documentId) {
      return latest
    }

    if (!latest || compareJobRecency(candidate, latest) > 0) {
      return candidate
    }

    return latest
  }, null)

  return latestDocumentJob?._id === job._id
}

function selectBackoffDelay(status: IngestionStatus) {
  if (status === "processing_provider") {
    return 10_000
  }

  return 30_000
}

function canReconcileStatus(status: IngestionStatus) {
  return status === "waiting_provider" || status === "processing_provider" || status === "downloading_result"
}

function selectSingleResult(results: Awaited<ReturnType<typeof getMineruBatchResult>>["results"]) {
  const [result] = results
  if (!result) {
    throw new Error("MinerU batch result did not include any files")
  }

  return result
}

function decodeArchiveJson(buffer: ArrayBuffer, filePattern: RegExp) {
  const files = unzipSync(new Uint8Array(buffer))
  const match = Object.entries(files).find(([fileName]) => filePattern.test(fileName))
  if (!match) {
    throw new Error("MinerU result archive is missing the expected JSON payload")
  }

  return JSON.parse(new TextDecoder().decode(match[1]))
}

function parseCallbackEnvelope(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new ConvexError("Invalid MinerU callback payload")
  }

  const checksum = "checksum" in payload && typeof payload.checksum === "string" ? payload.checksum : ""
  const rawContent = "content" in payload ? payload.content : undefined
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent)
  if (!checksum || !content) {
    throw new ConvexError("MinerU callback payload is missing checksum or content")
  }

  return {
    checksum,
    content,
    parsedContent: JSON.parse(content) as { batch_id?: string }
  }
}

export const listJobs = query({
  args: { sessionToken: v.string() },
  returns: v.array(listJobValidator),
  handler: async (ctx, args) => {
    await requireAdminQuerySession(ctx, args.sessionToken)
    const jobs = await ctx.db.query("ingestionJobs").collect()
    return jobs.map((job) => ({
      _creationTime: job._creationTime,
      _id: job._id,
      createdAt: job.createdAt,
      documentId: job.documentId,
      ...(job.errorMessage === undefined ? {} : { errorMessage: job.errorMessage }),
      ...(job.providerErrorCode === undefined ? {} : { providerErrorCode: job.providerErrorCode }),
      ...(job.providerErrorMessage === undefined ? {} : { providerErrorMessage: job.providerErrorMessage }),
      ...(job.providerLastCheckedAt === undefined ? {} : { providerLastCheckedAt: job.providerLastCheckedAt }),
      ...(job.providerState === undefined ? {} : { providerState: job.providerState }),
      status: job.status
    }))
  }
})

export const enqueue = mutation({
  args: { documentId: v.id("documents"), sessionToken: v.string() },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const now = Date.now()
    const jobId = await ctx.db.insert("ingestionJobs", {
      createdAt: now,
      documentId: args.documentId,
      requestedByAdmin: adminSession.username,
      status: "queued",
      updatedAt: now
    })

    await ctx.scheduler.runAfter(0, internal.ingestion.runDocumentJob, {
      documentId: args.documentId,
      jobId
    })

    return jobId
  }
})

export const retry = mutation({
  args: { jobId: v.id("ingestionJobs"), sessionToken: v.string() },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const existing = await ctx.db.get(args.jobId)
    if (!existing) {
      throw new ConvexError("Ingestion job not found")
    }

    const documentJobs = await ctx.db
      .query("ingestionJobs")
      .withIndex("by_document", (q) => q.eq("documentId", existing.documentId))
      .collect()
    if (!isRetryableJob(existing, documentJobs)) {
      throw new ConvexError("Only the latest failed ingestion job can be retried")
    }

    const now = Date.now()
    const retryJobId = await ctx.db.insert("ingestionJobs", {
      documentId: existing.documentId,
      requestedByAdmin: adminSession.username,
      status: "queued",
      createdAt: now,
      updatedAt: now
    })

    await ctx.scheduler.runAfter(0, internal.ingestion.runDocumentJob, {
      documentId: existing.documentId,
      jobId: retryJobId
    })

    return retryJobId
  }
})

export const getJobById = internalQuery({
  args: { jobId: v.id("ingestionJobs") },
  returns: jobByIdValidator,
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId)
  }
})

export const getJobByProviderBatchId = internalQuery({
  args: { providerBatchId: v.string() },
  returns: jobByIdValidator,
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ingestionJobs")
      .withIndex("by_provider_batch_id", (q) => q.eq("providerBatchId", args.providerBatchId))
      .unique()
  }
})

export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("ingestionJobs"),
    status: ingestionStatusValidator,
    errorMessage: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }

    assertNextIngestionStatus(job.status, args.status)
    const patch: { errorMessage?: string; status: typeof args.status; updatedAt: number } = {
      status: args.status,
      updatedAt: Date.now()
    }
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage
    }

    await ctx.db.patch(args.jobId, patch)
    return null
  }
})

export const recordProviderSubmission = internalMutation({
  args: {
    jobId: v.id("ingestionJobs"),
    priorityQuotaBucket: v.union(v.literal("priority_expected"), v.literal("standard_possible"), v.literal("unknown")),
    providerBatchId: v.string(),
    providerTraceId: v.optional(v.string()),
    sourceFileName: v.string(),
    sourceMimeType: v.string(),
    sourceStorageId: v.id("_storage")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }

    assertNextIngestionStatus(job.status, "waiting_provider")
    await ctx.db.patch(args.jobId, {
      priorityQuotaBucket: args.priorityQuotaBucket,
      provider: "mineru",
      providerBatchId: args.providerBatchId,
      providerReconcileFailureCount: 0,
      providerState: "pending",
      ...(args.providerTraceId === undefined ? {} : { providerTraceId: args.providerTraceId }),
      providerSubmittedAt: Date.now(),
      sourceFileName: args.sourceFileName,
      sourceMimeType: args.sourceMimeType,
      sourceStorageId: args.sourceStorageId,
      status: "waiting_provider",
      updatedAt: Date.now()
    })
    return null
  }
})

export const recordProviderProgress = internalMutation({
    args: {
      jobId: v.id("ingestionJobs"),
      providerDataId: v.optional(v.string()),
      providerErrorCode: v.optional(v.number()),
      providerErrorMessage: v.optional(v.string()),
      providerReconcileFailureCount: v.optional(v.number()),
      providerResultUrl: v.optional(v.string()),
      providerState: v.string(),
      providerTraceId: v.optional(v.string()),
    status: ingestionStatusValidator
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }

    if (job.status !== args.status) {
      assertNextIngestionStatus(job.status, args.status)
    }

    const now = Date.now()
    await ctx.db.patch(args.jobId, buildProviderProgressPatch(args, now))
    return null
  }
})

export const recordProviderCallback = internalMutation({
  args: { jobId: v.id("ingestionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }

    await ctx.db.patch(args.jobId, {
      providerCallbackVerifiedAt: Date.now(),
      updatedAt: Date.now()
    })
    return null
  }
})

export const claimProviderFinalization = internalMutation({
  args: { jobId: v.id("ingestionJobs") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.status !== "downloading_result") {
      return false
    }

    assertNextIngestionStatus(job.status, "normalizing")
    await ctx.db.patch(args.jobId, {
      status: "normalizing",
      updatedAt: Date.now()
    })
    return true
  }
})

export const runDocumentJob = internalAction({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.runQuery(internal.documents.getById, { documentId: args.documentId })
    if (!document) {
      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        errorMessage: "Document not found",
        jobId: args.jobId,
        status: "failed"
      })
      return null
    }

    let sourceStorageId: Id<"_storage"> | null = null
    let submissionRecorded = false

    try {
      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "downloading"
      })

      const response = await fetch(document.sourceUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch source PDF: ${response.status} ${response.statusText}`)
      }

      const sourceBlob = await response.blob()
      sourceStorageId = await ctx.storage.store(sourceBlob)
      const sourceMimeType = response.headers.get("content-type")?.trim() || "application/pdf"
      const sourceFileName = `${document.productSlug}-${document.version}.pdf`

      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "submitting"
      })

      const providerSubmission = await submitMineruBatch({
        ...(getProviderEnv().mineruCallbackSeed === undefined ? {} : { callbackSeed: getProviderEnv().mineruCallbackSeed }),
        ...(getProviderEnv().mineruCallbackUrl === undefined ? {} : { callbackUrl: getProviderEnv().mineruCallbackUrl }),
        file: sourceBlob,
        fileName: sourceFileName,
        token: getProviderEnv().mineruApiToken
      })

      await ctx.runMutation(internal.ingestion.recordProviderSubmission, {
        jobId: args.jobId,
        priorityQuotaBucket: "unknown",
        providerBatchId: providerSubmission.batchId,
        ...(providerSubmission.traceId === undefined ? {} : { providerTraceId: providerSubmission.traceId }),
        sourceFileName,
        sourceMimeType,
        sourceStorageId
      })
      submissionRecorded = true

      await ctx.scheduler.runAfter(5_000, internal.ingestion.reconcileProviderJob, {
        jobId: args.jobId
      })

      return null
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown ingestion error"

      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage,
        jobId: args.jobId,
        documentId: args.documentId
      })

      if (sourceStorageId && !submissionRecorded) {
        try {
          await ctx.storage.delete(sourceStorageId)
        } catch {
          // Best-effort cleanup only.
        }
      }

      return null
    }
  }
})

export const reconcileProviderJob = internalAction({
  args: { jobId: v.id("ingestionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.ingestion.getJobById, { jobId: args.jobId })
    if (!job?.providerBatchId || !canReconcileStatus(job.status)) {
      return null
    }

    try {
      const providerResult = await getMineruBatchResult({
        batchId: job.providerBatchId,
        token: getProviderEnv().mineruApiToken
      })
      const result = selectSingleResult(providerResult.results)

      if (result.state === "failed") {
        const providerFailureMessage = getProviderFailureMessage(result.errorMessage)

        await ctx.runMutation(internal.ingestion.recordProviderProgress, {
          jobId: args.jobId,
          ...(result.dataId === undefined ? {} : { providerDataId: result.dataId }),
          ...(result.errorCode === undefined ? {} : { providerErrorCode: result.errorCode }),
          providerErrorMessage: providerFailureMessage,
          providerReconcileFailureCount: 0,
          providerState: result.state,
          ...(providerResult.traceId === undefined ? {} : { providerTraceId: providerResult.traceId }),
          status: job.status
        })

        await ctx.runMutation(internal.documents.markFailed, {
          errorMessage: providerFailureMessage,
          jobId: args.jobId,
          documentId: job.documentId
        })
        return null
      }

      const nextStatus = mapMineruBatchState(result.state)
      await ctx.runMutation(internal.ingestion.recordProviderProgress, {
        jobId: args.jobId,
        ...(result.dataId === undefined ? {} : { providerDataId: result.dataId }),
        ...(result.errorCode === undefined ? {} : { providerErrorCode: result.errorCode }),
        ...(result.errorMessage === undefined ? {} : { providerErrorMessage: result.errorMessage }),
        providerReconcileFailureCount: 0,
        ...(result.resultUrl === undefined ? {} : { providerResultUrl: result.resultUrl }),
        providerState: result.state,
        ...(providerResult.traceId === undefined ? {} : { providerTraceId: providerResult.traceId }),
        status: nextStatus
      })

      if (nextStatus === "downloading_result") {
        await ctx.scheduler.runAfter(0, internal.ingestion.finalizeProviderResult, {
          documentId: job.documentId,
          jobId: args.jobId
        })
        return null
      }

      await ctx.scheduler.runAfter(selectBackoffDelay(nextStatus), internal.ingestion.reconcileProviderJob, {
        jobId: args.jobId
      })
      return null
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown provider reconciliation error"
      const decision = getProviderReconcileDecision(job.providerReconcileFailureCount ?? 0)

      await ctx.runMutation(internal.ingestion.recordProviderProgress, {
        jobId: args.jobId,
        providerErrorMessage: errorMessage,
        providerReconcileFailureCount: decision.nextFailureCount,
        providerState: job.providerState || "pending",
        status: job.status
      })

      if (decision.shouldFail) {
        await ctx.runMutation(internal.documents.markFailed, {
          errorMessage,
          jobId: args.jobId,
          documentId: job.documentId
        })
        return null
      }

      await ctx.scheduler.runAfter(selectBackoffDelay(job.status), internal.ingestion.reconcileProviderJob, {
        jobId: args.jobId
      })
      return null
    }
  }
})

export const finalizeProviderResult = internalAction({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.ingestion.claimProviderFinalization, {
      jobId: args.jobId
    })
    if (!claimed) {
      return null
    }

    const job = await ctx.runQuery(internal.ingestion.getJobById, { jobId: args.jobId })
    if (!job?.providerResultUrl || !job.sourceStorageId || !job.sourceFileName || !job.sourceMimeType) {
      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage: "MinerU job is missing the result or source file metadata",
        jobId: args.jobId,
        documentId: args.documentId
      })
      return null
    }

    const document = await ctx.runQuery(internal.documents.getById, { documentId: args.documentId })
    if (!document) {
      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage: "Document not found",
        jobId: args.jobId,
        documentId: args.documentId
      })
      return null
    }

    try {
      const response = await fetch(job.providerResultUrl)
      if (!response.ok) {
        throw new Error(`Failed to download MinerU result: ${response.status} ${response.statusText}`)
      }

      const archive = await response.arrayBuffer()
      const middleJson = decodeArchiveJson(archive, /middle\.json$/)
      const normalized = normalizeMineruDocument(middleJson)
      const payload = await buildDocumentPayload({
        embed: (inputs) => embedTexts(inputs),
        onBeforeEmbed: async () => {
          await ctx.runMutation(internal.ingestion.updateJobStatus, {
            jobId: args.jobId,
            status: "embedding"
          })
        },
        ocr: (sourceUrl, pageNumber) => ocrPdfPage(sourceUrl, pageNumber),
        parsedPages: normalized.pages,
        sourceUrl: document.sourceUrl
      })

      await ctx.runMutation(internal.documents.replaceParsedContent, {
        chunks: payload.chunks,
        documentId: args.documentId,
        embeddings: payload.embeddings,
        jobId: args.jobId,
        pages: payload.pages,
        sourceFileName: job.sourceFileName,
        sourceMimeType: job.sourceMimeType,
        sourceStorageId: job.sourceStorageId
      })

      return null
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown MinerU finalization error"
      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage,
        jobId: args.jobId,
        documentId: args.documentId
      })
      return null
    }
  }
})

export const mineruCallback = httpAction(async (ctx, request) => {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new Response("Invalid MinerU callback body", { status: 400 })
  }

  let envelope: ReturnType<typeof parseCallbackEnvelope>
  try {
    envelope = parseCallbackEnvelope(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid MinerU callback payload"
    return new Response(message, { status: 400 })
  }

  const providerEnv = getProviderEnv()
  const callbackUid = process.env.MINERU_CALLBACK_UID?.trim()
  if (!callbackUid || !providerEnv.mineruCallbackSeed) {
    return new Response("MinerU callback verification is not configured", { status: 503 })
  }

  if (
    !(await verifyMineruChecksum({
      checksum: envelope.checksum,
      content: envelope.content,
      seed: providerEnv.mineruCallbackSeed,
      uid: callbackUid
    }))
  ) {
    return new Response("Invalid MinerU callback checksum", { status: 401 })
  }

  const providerBatchId = envelope.parsedContent.batch_id?.trim()
  if (!providerBatchId) {
    return new Response("MinerU callback is missing batch_id", { status: 400 })
  }

  const job = await ctx.runQuery(internal.ingestion.getJobByProviderBatchId, {
    providerBatchId
  })
  if (!job) {
    return new Response("Unknown MinerU batch", { status: 202 })
  }

  await ctx.runMutation(internal.ingestion.recordProviderCallback, {
    jobId: job._id
  })
  await ctx.scheduler.runAfter(0, internal.ingestion.reconcileProviderJob, {
    jobId: job._id
  })

  return new Response("OK", { status: 200 })
})
