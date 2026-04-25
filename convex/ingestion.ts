import type { Id } from "./_generated/dataModel"
import type { IngestionStatus } from "./lib/ingestionState"

import { ConvexError, v } from "convex/values"

import { unzipSync } from "fflate"

import { api, internal } from "./_generated/api"
import { action, httpAction, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { insertAdminAuditEvent, requireAdminQuerySession, requireAdminWriteSession } from "./lib/adminSession"
import { getProviderEnv } from "./lib/env"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { getMineruBatchResult, mapMineruBatchState, submitMineruBatch } from "./lib/mineru"
import { verifyMineruChecksum } from "./lib/mineruCallback"
import { buildProviderProgressPatch, getProviderFailureMessage, getProviderReconcileDecision } from "./lib/providerRetry"
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
  recoverableAt: v.optional(v.number()),
  serverNow: v.number(),
  status: ingestionStatusValidator,
  updatedAt: v.number()
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

const prepareMineruUploadValidator = v.object({
  batchId: v.string(),
  traceId: v.optional(v.string())
})

type RetryableIngestionJob = {
  _creationTime: number
  _id: Id<"ingestionJobs">
  createdAt: number
  documentId: Id<"documents">
  status: IngestionStatus
}

type RecoverableIngestionJob = RetryableIngestionJob & {
  updatedAt: number
}

const STUCK_JOB_RECOVERY_WINDOW_MS = 15 * 60 * 1000
const STUCK_JOB_RECOVERY_ERROR_MESSAGE = "Admin recovery marked this stuck ingestion job as failed."

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

function isRecoverableStatus(status: IngestionStatus) {
  return status === "submitting" || status === "normalizing"
}

export function isRecoverableStuckJob(job: RecoverableIngestionJob, jobs: RecoverableIngestionJob[], now = Date.now()) {
  if (!isRecoverableStatus(job.status)) {
    return false
  }

  if (now - job.updatedAt < STUCK_JOB_RECOVERY_WINDOW_MS) {
    return false
  }

  const latestDocumentJob = jobs.reduce<RecoverableIngestionJob | null>((latest, candidate) => {
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

export function selectMineruArchiveJson(files: Record<string, Uint8Array>) {
  const match = Object.entries(files).find(([fileName]) => /(?:layout|middle)\.json$/.test(fileName))
  if (!match) {
    throw new Error("MinerU result archive is missing the expected JSON payload")
  }

  return JSON.parse(new TextDecoder().decode(match[1]))
}

export function decodeMineruArchiveJson(buffer: ArrayBuffer) {
  return selectMineruArchiveJson(unzipSync(new Uint8Array(buffer)))
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
    const now = Date.now()
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
      ...(isRecoverableStatus(job.status) &&
      compareJobRecency(
        job,
        jobs.reduce<RetryableIngestionJob | null>((latest, candidate) => {
          if (candidate.documentId !== job.documentId) {
            return latest
          }

          if (!latest || compareJobRecency(candidate, latest) > 0) {
            return candidate
          }

          return latest
        }, null) ?? job
      ) === 0
        ? { recoverableAt: job.updatedAt + STUCK_JOB_RECOVERY_WINDOW_MS }
        : {}),
      serverNow: now,
      status: job.status,
      updatedAt: job.updatedAt
    }))
  }
})

export const enqueue = mutation({
  args: {
    documentId: v.id("documents"),
    sessionToken: v.string(),
    providerBatchId: v.optional(v.string()),
    providerTraceId: v.optional(v.string()),
    sourceFileName: v.string(),
    sourceMimeType: v.string(),
    sourceStorageId: v.id("_storage")
  },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const now = Date.now()
    let jobId: Id<"ingestionJobs">

    if (args.providerBatchId === undefined) {
      jobId = await ctx.db.insert("ingestionJobs", {
        createdAt: now,
        documentId: args.documentId,
        requestedByAdmin: adminSession.username,
        sourceFileName: args.sourceFileName,
        sourceMimeType: args.sourceMimeType,
        sourceStorageId: args.sourceStorageId,
        status: "queued",
        updatedAt: now
      })
    } else {
      jobId = await ctx.db.insert("ingestionJobs", {
        createdAt: now,
        documentId: args.documentId,
        priorityQuotaBucket: "unknown",
        provider: "mineru",
        providerBatchId: args.providerBatchId,
        ...(args.providerTraceId === undefined ? {} : { providerTraceId: args.providerTraceId }),
        providerState: "pending",
        providerSubmittedAt: now,
        requestedByAdmin: adminSession.username,
        sourceFileName: args.sourceFileName,
        sourceMimeType: args.sourceMimeType,
        sourceStorageId: args.sourceStorageId,
        status: "waiting_provider",
        updatedAt: now
      })
    }

    await insertAdminAuditEvent(ctx, adminSession, {
      action: "ingestion.enqueue",
      targetId: jobId,
      targetTable: "ingestionJobs",
      summary: `Queued ingestion for ${args.documentId}`
    })

    if (args.providerBatchId === undefined) {
      await ctx.scheduler.runAfter(0, internal.ingestionNode.runDocumentJob, {
        documentId: args.documentId,
        jobId
      })
    } else {
      await ctx.scheduler.runAfter(0, internal.ingestion.reconcileProviderJob, {
        jobId
      })
    }

    return jobId
  }
})

export const prepareMineruUpload = action({
  args: {
    fileName: v.string(),
    sessionToken: v.string(),
    sourceStorageId: v.id("_storage")
  },
  returns: prepareMineruUploadValidator,
  handler: async (ctx, args) => {
    await ctx.runQuery(api.documents.listAdmin, { sessionToken: args.sessionToken })
    const sourceBlob = await ctx.storage.get(args.sourceStorageId)
    if (!sourceBlob) {
      throw new Error("Source file not found in storage")
    }

    return await submitMineruBatch({
      file: sourceBlob,
      fileName: args.fileName,
      ...(getProviderEnv().mineruCallbackSeed === undefined ? {} : { callbackSeed: getProviderEnv().mineruCallbackSeed }),
      ...(getProviderEnv().mineruCallbackUrl === undefined ? {} : { callbackUrl: getProviderEnv().mineruCallbackUrl }),
      token: getProviderEnv().mineruApiToken
    })
  }
})

export const retry = mutation({
  args: { jobId: v.id("ingestionJobs"), sessionToken: v.string() },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const existing = await ctx.db.get("ingestionJobs", args.jobId)
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
      ...(existing.sourceFileName === undefined ? {} : { sourceFileName: existing.sourceFileName }),
      ...(existing.sourceMimeType === undefined ? {} : { sourceMimeType: existing.sourceMimeType }),
      ...(existing.sourceStorageId === undefined ? {} : { sourceStorageId: existing.sourceStorageId }),
      status: "queued",
      createdAt: now,
      updatedAt: now
    })

    await insertAdminAuditEvent(ctx, adminSession, {
      action: "ingestion.retry",
      targetId: retryJobId,
      targetTable: "ingestionJobs",
      summary: `Retried ingestion for ${existing.documentId}`
    })

    await ctx.scheduler.runAfter(0, internal.ingestionNode.runDocumentJob, {
      documentId: existing.documentId,
      jobId: retryJobId
    })

    return retryJobId
  }
})

export const recoverStuckJob = mutation({
  args: { jobId: v.id("ingestionJobs"), sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const existing = await ctx.db.get("ingestionJobs", args.jobId)
    if (!existing) {
      throw new ConvexError("Ingestion job not found")
    }

    if (existing.status === "failed" && existing.errorMessage === STUCK_JOB_RECOVERY_ERROR_MESSAGE) {
      return null
    }

    const documentJobs = await ctx.db
      .query("ingestionJobs")
      .withIndex("by_document", (q) => q.eq("documentId", existing.documentId))
      .collect()
    if (!isRecoverableStuckJob(existing, documentJobs)) {
      throw new ConvexError("Only the latest stale ingestion job can be recovered")
    }

    assertNextIngestionStatus(existing.status, "failed")

    const now = Date.now()
    await ctx.db.patch("ingestionJobs", args.jobId, {
      errorMessage: STUCK_JOB_RECOVERY_ERROR_MESSAGE,
      status: "failed",
      updatedAt: now
    })

    const document = await ctx.db.get("documents", existing.documentId)
    if (document) {
      await ctx.db.patch("documents", existing.documentId, {
        status: "failed",
        updatedAt: now
      })
    }

    await insertAdminAuditEvent(ctx, adminSession, {
      action: "ingestion.recover",
      targetId: args.jobId,
      targetTable: "ingestionJobs",
      summary: `Recovered stuck ingestion for ${existing.documentId}`
    })

    return null
  }
})

export const getJobById = internalQuery({
  args: { jobId: v.id("ingestionJobs") },
  returns: jobByIdValidator,
  handler: async (ctx, args) => {
    return await ctx.db.get("ingestionJobs", args.jobId)
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
    const job = await ctx.db.get("ingestionJobs", args.jobId)
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

    await ctx.db.patch("ingestionJobs", args.jobId, patch)
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
    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (!job) {
      return null
    }

    assertNextIngestionStatus(job.status, "waiting_provider")
    await ctx.db.patch("ingestionJobs", args.jobId, {
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
    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (!job) {
      return null
    }

    if (job.status !== args.status) {
      assertNextIngestionStatus(job.status, args.status)
    }

    const now = Date.now()
    await ctx.db.patch("ingestionJobs", args.jobId, buildProviderProgressPatch(args, now))
    return null
  }
})

export const recordProviderCallback = internalMutation({
  args: { jobId: v.id("ingestionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (!job) {
      return null
    }

    await ctx.db.patch("ingestionJobs", args.jobId, {
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
    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (!job || job.status !== "downloading_result") {
      return false
    }

    assertNextIngestionStatus(job.status, "normalizing")
    await ctx.db.patch("ingestionJobs", args.jobId, {
      status: "normalizing",
      updatedAt: Date.now()
    })
    return true
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
        await ctx.scheduler.runAfter(0, internal.ingestionNode.finalizeProviderResult, {
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
