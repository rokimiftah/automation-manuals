import type { MutationCtx } from "./_generated/server"
import type { IngestionStatus } from "./lib/ingestionState"
import type { GenericId } from "convex/values"

import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { insertAdminAuditEvent, requireAdminQuerySession, requireAdminWriteSession } from "./lib/adminSession"
import { assertReadyDocumentArtifacts, buildReadyDocumentPatch } from "./lib/documentReadiness"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { chunkTypeValidator, documentStatusValidator } from "./lib/validators"

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function requireText(field: string, value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new ConvexError(`${field} is required`)
  }

  return trimmed
}

const JINA_EMBEDDING_PROVIDER = "jina" as const
const JINA_DOCUMENT_TASK = "retrieval.passage" as const
const JINA_EMBEDDING_DIMENSIONS = 1024

const parsedChunkValidator = v.object({
  citationLabel: v.string(),
  chunkType: chunkTypeValidator,
  content: v.string(),
  pageNumber: v.number()
})

const parsedPageValidator = v.object({
  markdown: v.string(),
  needsOcrFallback: v.boolean(),
  pageNumber: v.number(),
  printedPageNumber: v.optional(v.string())
})

type ParsedChunkInput = {
  citationLabel: string
  chunkType: "text" | "table" | "diagram_description" | "warning" | "spec"
  content: string
  pageNumber: number
}

type ParsedPageInput = {
  markdown: string
  needsOcrFallback: boolean
  pageNumber: number
  printedPageNumber?: string
}

type ParsedContentInput = {
  chunks: ParsedChunkInput[]
  documentId: GenericId<"documents">
  jobId: GenericId<"ingestionJobs">
  pages: ParsedPageInput[]
  sourceFileName: string
  sourceMimeType: string
  sourceStorageId: GenericId<"_storage">
}

type CurrentDocumentMetadata = {
  productSlug: string
  vendorSlug: string
}

type DocumentJobRef = {
  _creationTime: number
  _id: GenericId<"ingestionJobs">
  createdAt: number
  documentId: GenericId<"documents">
}

function compareDocumentJobRecency(left: DocumentJobRef, right: DocumentJobRef) {
  if (left._creationTime !== right._creationTime) {
    return left._creationTime - right._creationTime
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  return String(left._id).localeCompare(String(right._id))
}

function canTransitionToFailed(status: IngestionStatus) {
  try {
    assertNextIngestionStatus(status, "failed")
    return true
  } catch {
    return false
  }
}

async function ensureLatestJobCanCommit(
  ctx: MutationCtx,
  args: { documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs"> },
  job: { documentId: GenericId<"documents">; status: IngestionStatus } | null,
  now: number
) {
  const documentJobs = await ctx.db
    .query("ingestionJobs")
    .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
    .collect()
  const latestDocumentJob = documentJobs.reduce<DocumentJobRef | null>((latest, candidate) => {
    if (!latest || compareDocumentJobRecency(candidate, latest) > 0) {
      return candidate
    }

    return latest
  }, null)
  if (latestDocumentJob?._id === args.jobId) {
    return true
  }

  if (job?.documentId === args.documentId && canTransitionToFailed(job.status)) {
    await ctx.db.patch("ingestionJobs", args.jobId, {
      errorMessage: "A newer ingestion job replaced this result before it could be committed.",
      status: "failed",
      updatedAt: now
    })
  }

  return false
}

async function supersedeParsedArtifacts(ctx: MutationCtx, args: ParsedContentInput, now: number) {
  const currentAssets = await ctx.db
    .query("documentAssets")
    .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
    .collect()
  for (const asset of currentAssets) {
    await ctx.db.patch("documentAssets", asset._id, { isCurrent: false })
  }

  const currentPages = await ctx.db
    .query("documentPages")
    .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
    .collect()
  for (const page of currentPages) {
    await ctx.db.patch("documentPages", page._id, { isCurrent: false })
  }

  const currentChunks = await ctx.db
    .query("chunks")
    .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
    .collect()
  for (const chunk of currentChunks) {
    await ctx.db.patch("chunks", chunk._id, { isCurrent: false })
  }

  const currentEmbeddings = await ctx.db
    .query("chunkEmbeddings")
    .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
    .collect()
  for (const embedding of currentEmbeddings) {
    await ctx.db.delete("chunkEmbeddings", embedding._id)
  }

  const sourceAssetId = await ctx.db.insert("documentAssets", {
    createdAt: now,
    documentId: args.documentId,
    fileName: args.sourceFileName,
    ingestionJobId: args.jobId,
    isCurrent: true,
    kind: "source_pdf",
    mimeType: args.sourceMimeType,
    storageId: args.sourceStorageId
  })

  await Promise.all(
    args.pages.map((page) =>
      ctx.db.insert("documentPages", {
        documentId: args.documentId,
        ingestionJobId: args.jobId,
        isCurrent: true,
        markdown: page.markdown,
        needsOcrFallback: page.needsOcrFallback,
        pageNumber: page.pageNumber,
        ...(page.printedPageNumber === undefined ? {} : { printedPageNumber: page.printedPageNumber })
      })
    )
  )

  const chunkIds = await Promise.all(
    args.chunks.map((chunk) =>
      ctx.db.insert("chunks", {
        citationLabel: chunk.citationLabel,
        chunkType: chunk.chunkType,
        content: chunk.content,
        documentId: args.documentId,
        ingestionJobId: args.jobId,
        isCurrent: true,
        pageNumber: chunk.pageNumber
      })
    )
  )

  return { chunkIds, sourceAssetId }
}

async function scheduleEmbeddingBatchCreation(
  ctx: MutationCtx,
  args: { chunkIds: GenericId<"chunks">[]; documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs"> }
) {
  if (args.chunkIds.length === 0) {
    return
  }

  await ctx.scheduler.runAfter(0, internal.embeddingBatches.createBatchesForJob, {
    chunkIds: args.chunkIds,
    documentId: args.documentId,
    jobId: args.jobId
  })
}

async function markFinalizationFailed(
  ctx: MutationCtx,
  args: { documentId: GenericId<"documents">; jobId: GenericId<"ingestionJobs">; jobStatus?: IngestionStatus },
  errorMessage: string,
  now: number
) {
  if (args.jobStatus !== undefined) {
    assertNextIngestionStatus(args.jobStatus, "failed")
    await ctx.db.patch("ingestionJobs", args.jobId, {
      errorMessage,
      status: "failed",
      updatedAt: now
    })
  }

  await ctx.db.patch("documents", args.documentId, {
    status: "failed",
    updatedAt: now
  })
}

async function insertCurrentChunkEmbedding(
  ctx: MutationCtx,
  input: {
    chunkId: GenericId<"chunks">
    chunkType: ParsedChunkInput["chunkType"]
    document: CurrentDocumentMetadata
    documentId: GenericId<"documents">
    embedding: number[]
    embeddingModel: string
  }
) {
  await ctx.db.insert("chunkEmbeddings", {
    chunkId: input.chunkId,
    chunkType: input.chunkType,
    documentCurrentKey: `${input.documentId}:current`,
    documentId: input.documentId,
    embedding: input.embedding,
    embeddingDimensions: JINA_EMBEDDING_DIMENSIONS,
    embeddingModel: input.embeddingModel,
    embeddingProvider: JINA_EMBEDDING_PROVIDER,
    embeddingTask: JINA_DOCUMENT_TASK,
    isCurrent: true,
    productSlug: input.document.productSlug,
    vendorSlug: input.document.vendorSlug
  })
}

async function upsertVendor(ctx: MutationCtx, name: string) {
  const slug = toSlug(name)
  const existing = await ctx.db
    .query("vendors")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique()
  if (existing) {
    return existing._id
  }

  return await ctx.db.insert("vendors", { slug, name: name.trim(), createdAt: Date.now() })
}

async function upsertProduct(ctx: MutationCtx, vendorId: GenericId<"vendors">, name: string) {
  const slug = toSlug(name)
  const existing = await ctx.db
    .query("products")
    .withIndex("by_vendor_and_slug", (q) => q.eq("vendorId", vendorId).eq("slug", slug))
    .unique()
  if (existing) {
    return existing._id
  }

  return await ctx.db.insert("products", { vendorId, slug, name: name.trim(), createdAt: Date.now() })
}

const documentByIdValidator = v.union(
  v.null(),
  v.object({
    _creationTime: v.number(),
    _id: v.id("documents"),
    createdAt: v.number(),
    createdByAdmin: v.string(),
    language: v.string(),
    productId: v.id("products"),
    productSlug: v.string(),
    sourceAssetId: v.optional(v.id("documentAssets")),
    sourceUrl: v.string(),
    status: documentStatusValidator,
    title: v.string(),
    updatedAt: v.number(),
    vendorId: v.id("vendors"),
    vendorSlug: v.string(),
    version: v.string()
  })
)

export const getById = internalQuery({
  args: { documentId: v.id("documents") },
  returns: documentByIdValidator,
  handler: async (ctx, args) => {
    return await ctx.db.get("documents", args.documentId)
  }
})

export const generateSourceUploadUrl = mutation({
  args: { sessionToken: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireAdminWriteSession(ctx, args.sessionToken)
    return await ctx.storage.generateUploadUrl()
  }
})

export const stageParsedContent = internalMutation({
  args: {
    chunks: v.array(parsedChunkValidator),
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs"),
    pages: v.array(parsedPageValidator),
    sourceFileName: v.string(),
    sourceMimeType: v.string(),
    sourceStorageId: v.id("_storage")
  },
  returns: v.array(v.id("chunks")),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("documents", args.documentId)
    if (!document) {
      return []
    }

    const job = await ctx.db.get("ingestionJobs", args.jobId)
    const now = Date.now()
    if (!(await ensureLatestJobCanCommit(ctx, args, job, now))) {
      return []
    }

    if (job?.status === "embedding" || job?.status === "embedding_waiting_rate_limit" || job?.status === "ready") {
      return []
    }

    if (args.chunks.length === 0) {
      await markFinalizationFailed(
        ctx,
        { documentId: args.documentId, jobId: args.jobId, ...(job === null ? {} : { jobStatus: job.status }) },
        "At least one searchable chunk is required before a document can become ready",
        now
      )
      return []
    }

    if (job) {
      if (job.status === "downloading_result") {
        assertNextIngestionStatus(job.status, "normalizing")
      } else {
        assertNextIngestionStatus(job.status, "embedding")
      }
    }

    const { chunkIds } = await supersedeParsedArtifacts(ctx, args, now)
    await ctx.db.patch("documents", args.documentId, {
      status: "processing",
      updatedAt: now
    })

    if (args.chunks.length > 0) {
      if (job) {
        await ctx.db.patch("ingestionJobs", args.jobId, {
          status: "embedding",
          updatedAt: now
        })
      }

      await scheduleEmbeddingBatchCreation(ctx, {
        chunkIds,
        documentId: args.documentId,
        jobId: args.jobId
      })
    }

    return chunkIds
  }
})

export const insertChunkEmbeddingsBatch = internalMutation({
  args: {
    attemptCount: v.number(),
    batchId: v.id("embeddingBatches"),
    chunkIds: v.array(v.id("chunks")),
    embeddingModel: v.string(),
    embeddings: v.array(v.array(v.float64())),
    jobId: v.id("ingestionJobs")
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (args.chunkIds.length !== args.embeddings.length) {
      throw new Error("Chunk embeddings are misaligned")
    }

    const batch = await ctx.db.get(args.batchId)
    if (
      !batch ||
      batch.jobId !== args.jobId ||
      batch.status !== "processing" ||
      batch.attemptCount !== args.attemptCount ||
      batch.chunkIds.length !== args.chunkIds.length ||
      batch.chunkIds.some((chunkId, index) => chunkId !== args.chunkIds[index])
    ) {
      return 0
    }

    let insertedCount = 0
    for (const [index, chunkId] of args.chunkIds.entries()) {
      const currentEmbeddings = await ctx.db
        .query("chunkEmbeddings")
        .withIndex("by_chunk", (q) => q.eq("chunkId", chunkId))
        .collect()
      if (currentEmbeddings.some((embedding) => embedding.isCurrent)) {
        continue
      }

      const chunk = await ctx.db.get("chunks", chunkId)
      if (!chunk?.isCurrent) {
        continue
      }

      const document = await ctx.db.get("documents", chunk.documentId)
      const embedding = args.embeddings[index]
      if (!document || !embedding) {
        continue
      }

      await insertCurrentChunkEmbedding(ctx, {
        chunkId,
        chunkType: chunk.chunkType,
        document,
        documentId: chunk.documentId,
        embedding,
        embeddingModel: args.embeddingModel
      })
      insertedCount += 1
    }

    return insertedCount
  }
})

export const markReady = internalMutation({
  args: { documentId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("documents", args.documentId)
    if (!document) {
      return null
    }

    const currentAssets = await ctx.db
      .query("documentAssets")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()
    const sourceAssetId = currentAssets.find((asset) => asset.kind === "source_pdf")?._id

    const currentPages = await ctx.db
      .query("documentPages")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()

    const currentChunks = await ctx.db
      .query("chunks")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()

    const currentEmbeddings = await ctx.db
      .query("chunkEmbeddings")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()
    const embeddingCountByChunkId = new Map<string, number>()
    for (const embedding of currentEmbeddings) {
      embeddingCountByChunkId.set(embedding.chunkId, (embeddingCountByChunkId.get(embedding.chunkId) ?? 0) + 1)
    }
    const currentChunkIds = new Set(currentChunks.map((chunk) => chunk._id))
    const hasAlignedEmbeddings =
      currentEmbeddings.length === currentChunks.length &&
      currentEmbeddings.every((embedding) => currentChunkIds.has(embedding.chunkId)) &&
      currentChunks.every((chunk) => embeddingCountByChunkId.get(chunk._id) === 1)

    assertReadyDocumentArtifacts({
      chunkCount: currentChunks.length,
      hasAlignedEmbeddings,
      hasSourceAsset: sourceAssetId !== undefined,
      pageCount: currentPages.length
    })

    if (!sourceAssetId) {
      throw new Error("A current source asset is required before a document can become ready")
    }

    await ctx.db.patch("documents", args.documentId, buildReadyDocumentPatch({ now: Date.now(), sourceAssetId }))
    return null
  }
})

export const deleteDocument = mutation({
  args: {
    documentId: v.id("documents"),
    sessionToken: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const document = await ctx.db.get("documents", args.documentId)
    if (!document) {
      return null
    }

    const [documentAssets, documentPages, documentChunks, documentEmbeddings, documentJobs, documentEmbeddingBatches] =
      await Promise.all([
        ctx.db
          .query("documentAssets")
          .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId))
          .collect(),
        ctx.db
          .query("documentPages")
          .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId))
          .collect(),
        ctx.db
          .query("chunks")
          .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId))
          .collect(),
        ctx.db
          .query("chunkEmbeddings")
          .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId))
          .collect(),
        ctx.db
          .query("ingestionJobs")
          .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
          .collect(),
        ctx.db
          .query("embeddingBatches")
          .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
          .collect()
      ])
    const chunkTerms = await ctx.db
      .query("chunkTerms")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect()

    const documentEvidence = await ctx.db
      .query("answerEvidence")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect()

    const relatedSessionIds = new Set<GenericId<"chatSessions">>()
    for (const evidence of documentEvidence) {
      const message = await ctx.db.get(evidence.messageId)
      if (message) {
        relatedSessionIds.add(message.sessionId)
      }
    }

    const sessionsToDelete = new Set<GenericId<"chatSessions">>()
    const messagesToDelete = new Set<GenericId<"chatMessages">>()

    for (const sessionId of relatedSessionIds) {
      const sessionMessages = await ctx.db
        .query("chatMessages")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect()
      let hasForeignEvidence = false

      for (const message of sessionMessages) {
        const evidenceForMessage = await ctx.db
          .query("answerEvidence")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect()
        if (evidenceForMessage.some((evidence) => evidence.documentId !== args.documentId)) {
          hasForeignEvidence = true
          break
        }
      }

      if (hasForeignEvidence) {
        continue
      }

      sessionsToDelete.add(sessionId)
      for (const message of sessionMessages) {
        messagesToDelete.add(message._id)
      }
    }

    const storageIds = new Set<GenericId<"_storage">>()
    for (const asset of documentAssets) {
      storageIds.add(asset.storageId)
    }
    for (const job of documentJobs) {
      if (job.sourceStorageId !== undefined) {
        storageIds.add(job.sourceStorageId)
      }
    }

    await Promise.all([...storageIds].map((storageId) => ctx.storage.delete(storageId)))

    for (const evidence of documentEvidence) {
      await ctx.db.delete("answerEvidence", evidence._id)
    }

    for (const messageId of messagesToDelete) {
      await ctx.db.delete("chatMessages", messageId)
    }

    for (const sessionId of sessionsToDelete) {
      await ctx.db.delete("chatSessions", sessionId)
    }

    for (const embedding of documentEmbeddings) {
      await ctx.db.delete("chunkEmbeddings", embedding._id)
    }

    for (const chunk of documentChunks) {
      await ctx.db.delete("chunks", chunk._id)
    }

    for (const term of chunkTerms) {
      await ctx.db.delete("chunkTerms", term._id)
    }

    for (const batch of documentEmbeddingBatches) {
      await ctx.db.delete("embeddingBatches", batch._id)
    }

    for (const page of documentPages) {
      await ctx.db.delete("documentPages", page._id)
    }

    for (const asset of documentAssets) {
      await ctx.db.delete("documentAssets", asset._id)
    }

    for (const job of documentJobs) {
      await ctx.db.delete("ingestionJobs", job._id)
    }

    await ctx.db.delete("documents", args.documentId)

    await insertAdminAuditEvent(ctx, adminSession, {
      action: "document.delete",
      targetId: args.documentId,
      targetTable: "documents",
      summary: `Deleted ${document.title} ${document.version}`
    })

    return null
  }
})

export const markFailed = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs"),
    errorMessage: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (job?.documentId === args.documentId) {
      if (job.status !== "failed") {
        assertNextIngestionStatus(job.status, "failed")
        await ctx.db.patch("ingestionJobs", args.jobId, {
          errorMessage: args.errorMessage,
          status: "failed",
          updatedAt: now
        })
      }
    }

    const document = await ctx.db.get("documents", args.documentId)
    if (!document) {
      return null
    }

    const documentJobs = await ctx.db
      .query("ingestionJobs")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect()
    const latestDocumentJob = documentJobs.reduce<DocumentJobRef | null>((latest, candidate) => {
      if (!latest || compareDocumentJobRecency(candidate, latest) > 0) {
        return candidate
      }

      return latest
    }, null)
    if (latestDocumentJob?._id !== args.jobId) {
      return null
    }

    await ctx.db.patch("documents", args.documentId, { status: "failed", updatedAt: now })
    return null
  }
})

export const listAdmin = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      productSlug: v.string(),
      status: documentStatusValidator,
      title: v.string(),
      vendorSlug: v.string(),
      version: v.string()
    })
  ),
  handler: async (ctx, args) => {
    await requireAdminQuerySession(ctx, args.sessionToken)
    const documents = await ctx.db.query("documents").collect()
    return documents.map((doc) => ({
      _id: doc._id,
      productSlug: doc.productSlug,
      status: doc.status,
      title: doc.title,
      vendorSlug: doc.vendorSlug,
      version: doc.version
    }))
  }
})

export const create = mutation({
  args: {
    language: v.string(),
    productName: v.string(),
    sessionToken: v.string(),
    sourceStorageId: v.id("_storage"),
    title: v.string(),
    vendorName: v.string(),
    version: v.string()
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const vendorName = requireText("vendorName", args.vendorName)
    const productName = requireText("productName", args.productName)
    const title = requireText("title", args.title)
    const version = requireText("version", args.version)
    const language = requireText("language", args.language)
    const sourceUrl = await ctx.storage.getUrl(args.sourceStorageId)
    if (!sourceUrl) {
      throw new ConvexError("Source file is no longer available")
    }

    const now = Date.now()
    const vendorId = await upsertVendor(ctx, vendorName)
    const productId = await upsertProduct(ctx, vendorId, productName)
    const documentId = await ctx.db.insert("documents", {
      vendorId,
      productId,
      vendorSlug: toSlug(vendorName),
      productSlug: toSlug(productName),
      title,
      version,
      language,
      sourceUrl,
      status: "draft",
      createdByAdmin: adminSession.username,
      createdAt: now,
      updatedAt: now
    })

    await insertAdminAuditEvent(ctx, adminSession, {
      action: "document.create",
      targetId: documentId,
      targetTable: "documents",
      summary: `Created ${title} ${version}`
    })

    return documentId
  }
})
