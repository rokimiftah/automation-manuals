import type { MutationCtx } from "./_generated/server"
import type { GenericId } from "convex/values"

import { ConvexError, v } from "convex/values"

import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { insertAdminAuditEvent, requireAdminQuerySession, requireAdminWriteSession } from "./lib/adminSession"
import { assertReadyDocumentArtifacts, buildReadyDocumentPatch } from "./lib/documentReadiness"
import { buildChunkTerms } from "./lib/exactTerms"
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

export const replaceParsedContent = internalMutation({
  args: {
    chunks: v.array(
      v.object({
        citationLabel: v.string(),
        chunkType: chunkTypeValidator,
        content: v.string(),
        pageNumber: v.number()
      })
    ),
    documentId: v.id("documents"),
    embeddings: v.array(v.array(v.float64())),
    jobId: v.id("ingestionJobs"),
    pages: v.array(
      v.object({
        markdown: v.string(),
        needsOcrFallback: v.boolean(),
        pageNumber: v.number(),
        printedPageNumber: v.optional(v.string())
      })
    ),
    sourceFileName: v.string(),
    sourceMimeType: v.string(),
    sourceStorageId: v.id("_storage")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.embeddings.length !== args.chunks.length) {
      throw new Error("Chunk embeddings are misaligned")
    }

    const document = await ctx.db.get("documents", args.documentId)
    if (!document) {
      return null
    }

    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (job) {
      assertNextIngestionStatus(job.status, "ready")
    }

    const now = Date.now()

    assertReadyDocumentArtifacts({
      chunkCount: args.chunks.length,
      hasAlignedEmbeddings: args.embeddings.length === args.chunks.length,
      hasSourceAsset: true,
      pageCount: args.pages.length
    })

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
      const chunkTerms = await ctx.db
        .query("chunkTerms")
        .withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id))
        .collect()
      for (const term of chunkTerms) {
        await ctx.db.delete("chunkTerms", term._id)
      }
    }
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

    for (const [index, embedding] of args.embeddings.entries()) {
      const chunk = args.chunks[index]
      const chunkId = chunkIds[index]
      if (!chunk || !chunkId) {
        throw new Error("Chunk embeddings are misaligned")
      }

      await ctx.db.insert("chunkEmbeddings", {
        chunkId,
        chunkType: chunk.chunkType,
        documentCurrentKey: `${args.documentId}:current`,
        documentId: args.documentId,
        embedding,
        isCurrent: true,
        productSlug: document.productSlug,
        vendorSlug: document.vendorSlug
      })

      for (const term of buildChunkTerms({ citationLabel: chunk.citationLabel, content: chunk.content })) {
        await ctx.db.insert("chunkTerms", {
          chunkId,
          documentId: args.documentId,
          term
        })
      }
    }

    await ctx.db.patch("documents", args.documentId, buildReadyDocumentPatch({ now, sourceAssetId }))

    if (job) {
      await ctx.db.patch("ingestionJobs", args.jobId, {
        status: "ready",
        updatedAt: now
      })
    }

    return null
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

    const [documentAssets, documentPages, documentChunks, documentEmbeddings, documentJobs] = await Promise.all([
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

    await Promise.all(
      [...new Set(documentAssets.map((asset) => asset.storageId))].map((storageId) => ctx.storage.delete(storageId))
    )

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
    const job = await ctx.db.get("ingestionJobs", args.jobId)
    if (job) {
      assertNextIngestionStatus(job.status, "failed")
      await ctx.db.patch("ingestionJobs", args.jobId, {
        errorMessage: args.errorMessage,
        status: "failed",
        updatedAt: Date.now()
      })
    }

    const document = await ctx.db.get("documents", args.documentId)
    if (!document) {
      return null
    }

    await ctx.db.patch("documents", args.documentId, { status: "failed", updatedAt: Date.now() })
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
