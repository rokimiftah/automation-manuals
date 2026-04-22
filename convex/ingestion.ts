import { v } from "convex/values"

import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalAction, internalMutation, mutation, query } from "./_generated/server"
import { buildDocumentPayload } from "./lib/ingestDocument"
import { parseDocumentMarkdown } from "./lib/llamaCloud"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { embedTexts, ocrPdfPage } from "./lib/mistral"
import { ingestionStatusValidator } from "./lib/validators"
import { requireAdminViewer } from "./lib/viewer"

export const listJobs = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("ingestionJobs"),
      documentId: v.id("documents"),
      errorMessage: v.optional(v.string()),
      status: ingestionStatusValidator
    })
  ),
  handler: async (ctx) => {
    await requireAdminViewer(ctx)
    const jobs = await ctx.db.query("ingestionJobs").collect()
    return jobs.map((job) => ({
      _id: job._id,
      documentId: job.documentId,
      ...(job.errorMessage === undefined ? {} : { errorMessage: job.errorMessage }),
      status: job.status
    }))
  }
})

export const enqueue = mutation({
  args: { documentId: v.id("documents") },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const now = Date.now()
    const jobId = await ctx.db.insert("ingestionJobs", {
      documentId: args.documentId,
      requestedBy: viewer.userId,
      status: "queued",
      createdAt: now,
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
  args: { jobId: v.id("ingestionJobs") },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const existing = await ctx.db.get(args.jobId)
    if (!existing) {
      throw new Error("Ingestion job not found")
    }

    const now = Date.now()
    const retryJobId = await ctx.db.insert("ingestionJobs", {
      documentId: existing.documentId,
      requestedBy: viewer.userId,
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
      const sourceMimeType = response.headers.get("content-type") ?? "application/pdf"
      const sourceFileName = `${document.productSlug}-${document.version}.pdf`
      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "parsing"
      })

      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "normalizing"
      })

      const payload = await buildDocumentPayload({
        embed: (inputs) => embedTexts(inputs),
        ocr: (sourceUrl, pageNumber) => ocrPdfPage(sourceUrl, pageNumber),
        parse: () => parseDocumentMarkdown(document.sourceUrl),
        sourceUrl: document.sourceUrl
      })

      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "embedding"
      })

      await ctx.runMutation(internal.documents.replaceParsedContent, {
        chunks: payload.chunks,
        documentId: args.documentId,
        embeddings: payload.embeddings,
        jobId: args.jobId,
        pages: payload.pages,
        sourceFileName,
        sourceMimeType,
        sourceStorageId
      })

      return null
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown ingestion error"

      await ctx.runMutation(internal.documents.markFailed, {
        errorMessage,
        jobId: args.jobId,
        documentId: args.documentId
      })

      if (sourceStorageId) {
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
