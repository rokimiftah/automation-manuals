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
  adminSessions: defineTable({
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    tokenHash: v.string(),
    username: v.string()
  }).index("by_token_hash", ["tokenHash"]),
  adminLoginAttempts: defineTable({
    createdAt: v.number(),
    successful: v.boolean(),
    username: v.string()
  }).index("by_username_and_created_at", ["username", "createdAt"]),
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
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByAdmin: v.string()
  }).index("by_product", ["productId"]),
  ingestionJobs: defineTable({
    documentId: v.id("documents"),
    requestedByAdmin: v.string(),
    status: ingestionStatusValidator,
    errorMessage: v.optional(v.string()),
    provider: v.optional(v.literal("mineru")),
    providerBatchId: v.optional(v.string()),
    providerDataId: v.optional(v.string()),
    providerErrorCode: v.optional(v.number()),
    providerErrorMessage: v.optional(v.string()),
    providerReconcileFailureCount: v.optional(v.number()),
    providerResultUrl: v.optional(v.string()),
    providerState: v.optional(v.string()),
    providerTraceId: v.optional(v.string()),
    providerSubmittedAt: v.optional(v.number()),
    providerLastCheckedAt: v.optional(v.number()),
    providerCallbackVerifiedAt: v.optional(v.number()),
    priorityQuotaBucket: v.optional(
      v.union(v.literal("priority_expected"), v.literal("standard_possible"), v.literal("unknown"))
    ),
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
    .index("by_document_and_current_and_content", ["documentId", "isCurrent", "content"])
    .index("by_current_and_content", ["isCurrent", "content"])
    .index("by_document_and_page", ["documentId", "pageNumber"]),
  chunkTerms: defineTable({
    chunkId: v.id("chunks"),
    documentId: v.id("documents"),
    term: v.string()
  })
    .index("by_chunk", ["chunkId"])
    .index("by_document", ["documentId"])
    .index("by_term", ["term"]),
  chunkEmbeddings: defineTable({
    chunkId: v.id("chunks"),
    documentId: v.id("documents"),
    documentCurrentKey: v.string(),
    vendorSlug: v.string(),
    productSlug: v.string(),
    chunkType: chunkTypeValidator,
    embeddingProvider: v.literal("jina"),
    embeddingModel: v.string(),
    embeddingTask: v.literal("retrieval.passage"),
    embeddingDimensions: v.number(),
    isCurrent: v.boolean(),
    embedding: v.array(v.float64())
  })
    .index("by_chunk", ["chunkId"])
    .index("by_document_and_current", ["documentId", "isCurrent"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["documentCurrentKey", "documentId", "vendorSlug", "productSlug", "chunkType", "isCurrent"]
    }),
  embeddingBatches: defineTable({
    jobId: v.id("ingestionJobs"),
    documentId: v.id("documents"),
    batchIndex: v.number(),
    chunkIds: v.array(v.id("chunks")),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("rate_limited"),
      v.literal("retrying"),
      v.literal("completed"),
      v.literal("failed")
    ),
    attemptCount: v.number(),
    finalizedAt: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    lastErrorMessage: v.optional(v.string()),
    lastProviderKeyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_job", ["jobId"])
    .index("by_document", ["documentId"])
    .index("by_job_and_status", ["jobId", "status"])
    .index("by_next_run", ["nextRunAt"]),
  chatSessions: defineTable({
    accessTokenHash: v.optional(v.string()),
    title: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    lastAccessedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    searchRequestCount: v.optional(v.number()),
    searchWindowStart: v.optional(v.number()),
    updatedAt: v.number()
  }),
  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    role: messageRoleValidator,
    content: v.string(),
    answerabilityStatus: v.optional(answerabilityStatusValidator),
    createdAt: v.number()
  }).index("by_session", ["sessionId"]),
  answerEvidence: defineTable({
    documentId: v.id("documents"),
    messageId: v.id("chatMessages"),
    chunkId: v.id("chunks"),
    assetId: v.optional(v.id("documentAssets")),
    pageNumber: v.number(),
    score: v.number()
  })
    .index("by_document", ["documentId"])
    .index("by_message", ["messageId"]),
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
    actorLabel: v.string(),
    actorType: v.string(),
    adminSessionId: v.optional(v.id("adminSessions")),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    summary: v.string(),
    createdAt: v.number()
  }).index("by_actor_type", ["actorType"]),
  searchRateState: defineTable({
    globalRequestCount: v.number(),
    windowStart: v.number()
  }),
  providerApiKeyStates: defineTable({
    provider: v.union(v.literal("jina"), v.literal("inception")),
    keyId: v.string(),
    windowStart: v.number(),
    requestCount: v.number(),
    inputTokenCount: v.number(),
    outputTokenCount: v.number(),
    inFlightCount: v.number(),
    cooldownUntil: v.optional(v.number()),
    disabledAt: v.optional(v.number()),
    disabledReason: v.optional(v.string()),
    lastRateLimitedAt: v.optional(v.number()),
    updatedAt: v.number()
  })
    .index("by_provider", ["provider"])
    .index("by_provider_and_key", ["provider", "keyId"])
})
