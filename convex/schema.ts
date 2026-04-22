import { authTables } from "@convex-dev/auth/server"

import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import {
  answerabilityStatusValidator,
  chunkTypeValidator,
  documentStatusValidator,
  ingestionStatusValidator,
  messageRoleValidator,
  severityValidator
} from "./lib/validators"

export default defineSchema({
  ...authTables,
  vendors: defineTable({
    slug: v.string(),
    name: v.string(),
    createdAt: v.number()
  }).index("by_slug", ["slug"]),
  products: defineTable({
    vendorId: v.id("vendors"),
    slug: v.string(),
    name: v.string(),
    createdAt: v.number()
  }).index("by_vendor_and_slug", ["vendorId", "slug"]),
  documents: defineTable({
    vendorId: v.id("vendors"),
    productId: v.id("products"),
    vendorSlug: v.string(),
    productSlug: v.string(),
    title: v.string(),
    version: v.string(),
    language: v.string(),
    sourceUrl: v.string(),
    sourceAssetId: v.optional(v.id("documentAssets")),
    status: documentStatusValidator,
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users")
  })
    .index("by_product", ["productId"])
    .index("by_product_and_active", ["productId", "isActive"]),
  ingestionJobs: defineTable({
    documentId: v.id("documents"),
    requestedBy: v.id("users"),
    status: ingestionStatusValidator,
    errorMessage: v.optional(v.string()),
    provider: v.optional(v.literal("mineru")),
    providerBatchId: v.optional(v.string()),
    providerDataId: v.optional(v.string()),
    providerErrorCode: v.optional(v.number()),
    providerErrorMessage: v.optional(v.string()),
    providerResultUrl: v.optional(v.string()),
    providerState: v.optional(v.string()),
    providerTraceId: v.optional(v.string()),
    providerSubmittedAt: v.optional(v.number()),
    providerLastCheckedAt: v.optional(v.number()),
    providerCallbackVerifiedAt: v.optional(v.number()),
    priorityQuotaBucket: v.optional(v.union(v.literal("priority_expected"), v.literal("standard_possible"), v.literal("unknown"))),
    sourceStorageId: v.optional(v.id("_storage")),
    sourceFileName: v.optional(v.string()),
    sourceMimeType: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_document", ["documentId"])
    .index("by_provider_batch_id", ["providerBatchId"]),
  documentAssets: defineTable({
    documentId: v.id("documents"),
    ingestionJobId: v.id("ingestionJobs"),
    kind: v.literal("source_pdf"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    pageNumber: v.optional(v.number()),
    isCurrent: v.boolean(),
    createdAt: v.number()
  }).index("by_document_and_current", ["documentId", "isCurrent"]),
  documentPages: defineTable({
    documentId: v.id("documents"),
    ingestionJobId: v.id("ingestionJobs"),
    pageNumber: v.number(),
    printedPageNumber: v.optional(v.string()),
    markdown: v.string(),
    needsOcrFallback: v.boolean(),
    isCurrent: v.boolean()
  }).index("by_document_and_current", ["documentId", "isCurrent"]),
  chunks: defineTable({
    documentId: v.id("documents"),
    ingestionJobId: v.id("ingestionJobs"),
    pageNumber: v.number(),
    chunkType: chunkTypeValidator,
    content: v.string(),
    citationLabel: v.string(),
    isCurrent: v.boolean()
  })
    .index("by_document_and_current", ["documentId", "isCurrent"])
    .index("by_document_and_page", ["documentId", "pageNumber"]),
  chunkEmbeddings: defineTable({
    chunkId: v.id("chunks"),
    documentId: v.id("documents"),
    vendorSlug: v.string(),
    productSlug: v.string(),
    chunkType: chunkTypeValidator,
    isCurrent: v.boolean(),
    embedding: v.array(v.float64())
  })
    .index("by_chunk", ["chunkId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["documentId", "vendorSlug", "productSlug", "chunkType", "isCurrent"]
    }),
  chatSessions: defineTable({
    userId: v.id("users"),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_user", ["userId"]),
  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    userId: v.id("users"),
    role: messageRoleValidator,
    content: v.string(),
    answerabilityStatus: v.optional(answerabilityStatusValidator),
    createdAt: v.number()
  }).index("by_session", ["sessionId"]),
  answerEvidence: defineTable({
    messageId: v.id("chatMessages"),
    chunkId: v.id("chunks"),
    assetId: v.optional(v.id("documentAssets")),
    pageNumber: v.number(),
    score: v.number()
  }).index("by_message", ["messageId"]),
  evaluationCases: defineTable({
    slug: v.string(),
    question: v.string(),
    category: v.string(),
    severity: severityValidator,
    expectedDocumentTitle: v.string(),
    expectedPageNumbers: v.array(v.number()),
    expectedRefusal: v.boolean()
  }).index("by_slug", ["slug"]),
  auditEvents: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    summary: v.string(),
    createdAt: v.number()
  }).index("by_actor", ["actorUserId"]),
  comments: defineTable({
    author: v.string(),
    content: v.string()
  })
})
