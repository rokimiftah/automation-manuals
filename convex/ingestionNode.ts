"use node"

import type { Id } from "./_generated/dataModel"

import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { decodeMineruArchiveJson } from "./ingestion"
import { getProviderEnv } from "./lib/env"
import { buildNormalizedDocumentPayload } from "./lib/ingestDocument"
import { submitMineruBatch } from "./lib/mineru"
import { normalizeMineruDocument } from "./lib/mineruResult"
import { getProviderReconcileDecision } from "./lib/providerRetry"

const RESULT_DOWNLOAD_RETRY_DELAY_MS = 30_000

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

    const job = await ctx.runQuery(internal.ingestion.getJobById, { jobId: args.jobId })
    if (!job) {
      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage: "Ingestion job not found",
        jobId: args.jobId,
        documentId: args.documentId
      })
      return null
    }

    let sourceStorageId: Id<"_storage"> | null = null
    let createdSourceStorageId: Id<"_storage"> | null = null
    let submissionRecorded = false

    try {
      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "downloading"
      })

      let sourceBlob: Blob | null = null
      sourceStorageId = job.sourceStorageId ?? null

      if (sourceStorageId) {
        sourceBlob = await ctx.storage.get(sourceStorageId)
        if (!sourceBlob) {
          throw new Error("Source file not found in storage")
        }
      } else {
        const response = await fetch(document.sourceUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch source PDF: ${response.status} ${response.statusText}`)
        }

        sourceBlob = await response.blob()
        createdSourceStorageId = await ctx.storage.store(sourceBlob)
        sourceStorageId = createdSourceStorageId
      }

      if (!sourceBlob || !sourceStorageId) {
        throw new Error("Source file is not available")
      }

      const sourceMimeType = job.sourceMimeType || sourceBlob.type || "application/pdf"
      const sourceFileName = job.sourceFileName || `${document.productSlug}-${document.version}.pdf`

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

      return null
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown ingestion error"

      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage,
        jobId: args.jobId,
        documentId: args.documentId
      })

      if (createdSourceStorageId && !submissionRecorded) {
        try {
          await ctx.storage.delete(createdSourceStorageId)
        } catch {
          // Best-effort cleanup only.
        }
      }

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
    const job = await ctx.runQuery(internal.ingestion.getJobById, { jobId: args.jobId })
    if (!job || (job.status !== "downloading_result" && job.status !== "normalizing")) {
      return null
    }

    if (!job?.providerResultUrl || !job.sourceStorageId || !job.sourceFileName || !job.sourceMimeType) {
      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage: "MinerU job is missing the result or source file metadata",
        jobId: args.jobId,
        documentId: args.documentId
      })
      return null
    }

    let archive: ArrayBuffer
    try {
      const response = await fetch(job.providerResultUrl)
      if (!response.ok) {
        throw new Error(`Failed to download MinerU result: ${response.status} ${response.statusText}`)
      }
      archive = await response.arrayBuffer()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown MinerU result download error"
      const decision = getProviderReconcileDecision(job.providerReconcileFailureCount ?? 0)

      await ctx.runMutation(internal.ingestion.recordProviderProgress, {
        ...(job.status === "normalizing"
          ? { finalizeAfterMs: RESULT_DOWNLOAD_RETRY_DELAY_MS, finalizeDocumentId: args.documentId }
          : {}),
        jobId: args.jobId,
        providerErrorMessage: errorMessage,
        providerReconcileFailureCount: decision.nextFailureCount,
        providerState: job.providerState || "done",
        ...(decision.shouldFail || job.status === "normalizing" ? {} : { reconcileAfterMs: RESULT_DOWNLOAD_RETRY_DELAY_MS }),
        status: job.status
      })

      if (decision.shouldFail) {
        await ctx.runMutation(internal.documents.markFailed, {
          errorMessage,
          jobId: args.jobId,
          documentId: args.documentId
        })
        return null
      }

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
      const structuredJson = decodeMineruArchiveJson(archive)
      const normalized = normalizeMineruDocument(structuredJson)
      const payload = buildNormalizedDocumentPayload(normalized.pages)

      if (job.status === "downloading_result") {
        const claimed = await ctx.runMutation(internal.ingestion.claimProviderFinalization, {
          jobId: args.jobId
        })
        if (!claimed) {
          return null
        }
      }

      await ctx.runMutation(internal.documents.stageParsedContent, {
        chunks: payload.chunks,
        documentId: args.documentId,
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
