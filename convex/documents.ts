import { v } from "convex/values"
import { ConvexError } from "convex/values"
import type { GenericId } from "convex/values"

import type { MutationCtx } from "./_generated/server"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { chunkTypeValidator, documentStatusValidator } from "./lib/validators"
import { requireAdminViewer } from "./lib/viewer"

function toSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

function requireText(field: string, value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new ConvexError(`${field} is required`)
  }

  return trimmed
}

function requireHttpUrl(field: string, value: string) {
  const trimmed = requireText(field, value)
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ConvexError(`${field} must be a valid URL`)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConvexError(`${field} must use http or https`)
  }

  return parsed.toString()
}

async function upsertVendor(ctx: MutationCtx, name: string) {
  const slug = toSlug(name)
  const existing = await ctx.db.query("vendors").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()
  if (existing) {
    return existing._id
  }

  return await ctx.db.insert("vendors", { slug, name: name.trim(), createdAt: Date.now() })
}

async function upsertProduct(ctx: MutationCtx, vendorId: GenericId<"vendors">, name: string) {
  const slug = toSlug(name)
  const existing = await ctx.db.query("products").withIndex("by_vendor_and_slug", (q) => q.eq("vendorId", vendorId).eq("slug", slug)).unique()
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
    createdBy: v.id("users"),
    isActive: v.boolean(),
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
    return await ctx.db.get(args.documentId)
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

    const document = await ctx.db.get(args.documentId)
    if (!document) {
      return null
    }

    const job = await ctx.db.get(args.jobId)
    if (job) {
      assertNextIngestionStatus(job.status, "ready")
    }

    const now = Date.now()

    const currentAssets = await ctx.db
      .query("documentAssets")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()
    for (const asset of currentAssets) {
      await ctx.db.patch(asset._id, { isCurrent: false })
    }

    const currentPages = await ctx.db
      .query("documentPages")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()
    for (const page of currentPages) {
      await ctx.db.patch(page._id, { isCurrent: false })
    }

    const currentChunks = await ctx.db
      .query("chunks")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()
    for (const chunk of currentChunks) {
      await ctx.db.patch(chunk._id, { isCurrent: false })
      const currentEmbeddings = await ctx.db.query("chunkEmbeddings").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).collect()
      for (const embedding of currentEmbeddings) {
        await ctx.db.patch(embedding._id, { isCurrent: false })
      }
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
        documentId: args.documentId,
        embedding,
        isCurrent: true,
        productSlug: document.productSlug,
        vendorSlug: document.vendorSlug
      })
    }

    await ctx.db.patch(args.documentId, {
      sourceAssetId,
      status: "ready",
      updatedAt: now
    })

    if (job) {
      await ctx.db.patch(args.jobId, {
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
    const document = await ctx.db.get(args.documentId)
    if (!document) {
      return null
    }

    await ctx.db.patch(args.documentId, { status: "ready", updatedAt: Date.now() })
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
    const job = await ctx.db.get(args.jobId)
    if (job) {
      assertNextIngestionStatus(job.status, "failed")
      await ctx.db.patch(args.jobId, {
        errorMessage: args.errorMessage,
        status: "failed",
        updatedAt: Date.now()
      })
    }

    const document = await ctx.db.get(args.documentId)
    if (!document) {
      return null
    }

    await ctx.db.patch(args.documentId, { status: "failed", updatedAt: Date.now() })
    return null
  }
})

export const listAdmin = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      isActive: v.boolean(),
      productSlug: v.string(),
      status: documentStatusValidator,
      title: v.string(),
      vendorSlug: v.string(),
      version: v.string()
    })
  ),
  handler: async (ctx) => {
    await requireAdminViewer(ctx)
    const documents = await ctx.db.query("documents").collect()
    return documents.map((doc) => ({
      _id: doc._id,
      isActive: doc.isActive,
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
    vendorName: v.string(),
    productName: v.string(),
    title: v.string(),
    version: v.string(),
    language: v.string(),
    sourceUrl: v.string()
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const vendorName = requireText("vendorName", args.vendorName)
    const productName = requireText("productName", args.productName)
    const title = requireText("title", args.title)
    const version = requireText("version", args.version)
    const language = requireText("language", args.language)
    const sourceUrl = requireHttpUrl("sourceUrl", args.sourceUrl)
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
      isActive: false,
      createdAt: now,
      updatedAt: now,
      createdBy: viewer.userId
    })

    await ctx.db.insert("auditEvents", {
      actorUserId: viewer.userId,
      action: "document.create",
      targetTable: "documents",
      targetId: documentId,
      summary: `Created ${title} ${version}`,
      createdAt: now
    })

    return documentId
  }
})
