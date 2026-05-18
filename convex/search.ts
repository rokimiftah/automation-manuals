import type { ActionCtx, MutationCtx } from "./_generated/server"
import type { AnswerPacket } from "./lib/answerPacket"
import type { ProviderName } from "./lib/providerKeys"
import type { GenericId } from "convex/values"

import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import { action, internalMutation, internalQuery, mutation } from "./_generated/server"
import { requireAdminWriteSession } from "./lib/adminSession"
import { answerPacketValidator, buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./lib/answerPacket"
import { getProviderEnv } from "./lib/env"
import { buildChunkTerms, extractExactSearchTerms } from "./lib/exactTerms"
import { isLookupLikeQuery, mergeCandidates, rankExactCandidates } from "./lib/hybridRetrieval"
import { generateGroundedAnswer } from "./lib/inception"
import { embedSearchQuery, JINA_EMBEDDING_PROVIDER } from "./lib/jina"
import {
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./lib/providerErrors"
import { buildProviderKeyPool, resolveProviderKey } from "./lib/providerKeys"
import { detectQuestionLanguage } from "./lib/questionLanguage"

type SearchResult = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  content: string
  pageNumber: number
  score: number
}

type ExactSearchCandidate = Omit<SearchResult, "score">

type ExactTermBackfillChunk = {
  _id: GenericId<"chunks">
  citationLabel: string
  content: string
  documentId: GenericId<"documents">
  ingestionJobId: GenericId<"ingestionJobs">
}

type ExactTermCleanupChunk = {
  _id: GenericId<"chunks">
}

type ExactTermInsertCtx = Pick<MutationCtx, "db">

type ExactTermCleanupCtx = Pick<MutationCtx, "db">

type ExactSearchPage = {
  continueCursor: string
  isDone: boolean
  page: ExactSearchCandidate[]
}

export const DEFAULT_VECTOR_LIMIT = 6

export const DOCUMENT_SCOPED_VECTOR_LIMIT = 24

export const GLOBAL_EXACT_MATCH_LIMIT = 32

export const GLOBAL_EXACT_MATCH_SCAN_LIMIT = 128

export const GLOBAL_EXACT_MATCH_PAGE_SIZE = 32

const GLOBAL_EXACT_TERM_LIMIT = 64
const EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE = 50
const EXACT_TERM_BACKFILL_PHASE_CLEANUP = "cleanup" as const
const EXACT_TERM_BACKFILL_PHASE_BACKFILL = "backfill" as const

const SEARCH_RATE_WINDOW_MS = 60_000

const GLOBAL_SEARCH_REQUEST_LIMIT = 120

const SESSION_SEARCH_REQUEST_LIMIT = 10

const WEAK_VECTOR_EVIDENCE_THRESHOLD = 0.5

const INCEPTION_PROVIDER = "inception" as const

type ProviderReservation = { available: false; retryAfterMs: number } | { available: true; keyId: string }

type ProviderLabel = "Answer" | "Embedding"

export function getVectorSearchLimit(documentId?: GenericId<"documents">) {
  return documentId ? DOCUMENT_SCOPED_VECTOR_LIMIT : DEFAULT_VECTOR_LIMIT
}

export function getTopEvidenceScore(evidence: Array<{ score: number }>) {
  return evidence.reduce((topScore, item) => Math.max(topScore, item.score), 0)
}

function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateGroundedAnswerOutputTokens(answer: { answerSteps: string[]; answerSummary: string; citationIds: string[] }) {
  return estimateTokenCount(
    JSON.stringify({
      answerSteps: answer.answerSteps,
      answerSummary: answer.answerSummary,
      citationIds: answer.citationIds
    })
  )
}

function getProviderRetryAfterMs(retryAfterMs: number | undefined) {
  return Math.max(1, retryAfterMs ?? SEARCH_RATE_WINDOW_MS)
}

function providerCapacityError(label: ProviderLabel, retryAfterMs: number | undefined) {
  const retrySeconds = Math.ceil(getProviderRetryAfterMs(retryAfterMs) / 1000)
  return new ConvexError(
    `${label} provider capacity is temporarily unavailable. Please wait ${retrySeconds} seconds and try again.`
  )
}

function providerPermanentError(label: ProviderLabel) {
  return new ConvexError(`${label} provider configuration needs administrator attention.`)
}

async function reserveProviderKey(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    estimatedInputTokens: number
    estimatedOutputTokens: number
    inputTpmLimit: number
    keyIds: string[]
    maxConcurrent: number
    outputTpmLimit: number
    provider: ProviderName
    rpmLimit: number
  },
  label: ProviderLabel
) {
  let reservation: ProviderReservation
  try {
    reservation = (await ctx.runMutation(internal.providerRateLimits.reserveProviderKey, args)) as ProviderReservation
  } catch {
    throw providerCapacityError(label, undefined)
  }

  if (!reservation.available) {
    throw providerCapacityError(label, reservation.retryAfterMs)
  }

  return reservation.keyId
}

async function recordProviderSuccess(
  ctx: Pick<ActionCtx, "runMutation">,
  provider: ProviderName,
  keyId: string,
  label: ProviderLabel,
  accounting?: {
    inputTokens?: number
    outputTokens?: number
    reservedInputTokens?: number
    reservedOutputTokens?: number
  }
) {
  try {
    await ctx.runMutation(internal.providerRateLimits.recordProviderSuccess, {
      ...(accounting?.inputTokens === undefined ? {} : { inputTokens: accounting.inputTokens }),
      keyId,
      ...(accounting?.outputTokens === undefined ? {} : { outputTokens: accounting.outputTokens }),
      ...(accounting?.reservedInputTokens === undefined ? {} : { reservedInputTokens: accounting.reservedInputTokens }),
      ...(accounting?.reservedOutputTokens === undefined ? {} : { reservedOutputTokens: accounting.reservedOutputTokens }),
      provider
    })
  } catch {
    try {
      await ctx.runMutation(internal.providerRateLimits.recordProviderTransientFailure, {
        keyId,
        provider
      })
    } catch {
      // Keep user-facing errors sanitized even when provider accounting is degraded.
    }
    throw providerCapacityError(label, undefined)
  }
}

function setupProviderKeyPool<T>(label: ProviderLabel, setup: () => T) {
  try {
    return setup()
  } catch {
    throw providerPermanentError(label)
  }
}

async function handleProviderFailure(
  ctx: Pick<ActionCtx, "runMutation">,
  args: { error: unknown; label: ProviderLabel; provider: ProviderName; reservedKeyId: string }
): Promise<never> {
  if (args.error instanceof ProviderRateLimitError) {
    await ctx.runMutation(internal.providerRateLimits.recordProviderRateLimit, {
      keyId: args.error.keyId,
      provider: args.provider,
      retryAfterMs: getProviderRetryAfterMs(args.error.retryAfterMs)
    })
    throw providerCapacityError(args.label, args.error.retryAfterMs)
  }

  if (args.error instanceof ProviderQuotaExhaustedError) {
    await ctx.runMutation(internal.providerRateLimits.disableProviderKey, {
      keyId: args.error.keyId,
      provider: args.provider,
      reason: "quota_exhausted"
    })
    throw providerCapacityError(args.label, undefined)
  }

  if (args.error instanceof ProviderTransientError) {
    await ctx.runMutation(internal.providerRateLimits.recordProviderTransientFailure, {
      keyId: args.error.keyId ?? args.reservedKeyId,
      provider: args.provider
    })
    throw providerCapacityError(args.label, undefined)
  }

  if (args.error instanceof ProviderPermanentError) {
    await ctx.runMutation(internal.providerRateLimits.disableProviderKey, {
      keyId: args.error.keyId ?? args.reservedKeyId,
      provider: args.provider,
      reason: "permanent_error"
    })
    throw providerPermanentError(args.label)
  }

  await ctx.runMutation(internal.providerRateLimits.recordProviderTransientFailure, {
    keyId: args.reservedKeyId,
    provider: args.provider
  })
  throw providerPermanentError(args.label)
}

const searchResultValidator = v.object({
  assetId: v.optional(v.id("documentAssets")),
  citationLabel: v.string(),
  chunkId: v.id("chunks"),
  content: v.string(),
  pageNumber: v.number(),
  score: v.number()
})

const exactSearchCandidateValidator = v.object({
  assetId: v.optional(v.id("documentAssets")),
  citationLabel: v.string(),
  chunkId: v.id("chunks"),
  content: v.string(),
  pageNumber: v.number()
})

const savedEvidenceValidator = v.object({
  assetId: v.optional(v.id("documentAssets")),
  chunkId: v.id("chunks"),
  pageNumber: v.number(),
  score: v.number()
})

const searchRateLimitResultValidator = v.object({
  allowed: v.boolean(),
  retryAfterMs: v.optional(v.number())
})

function rankExactSearchResults(question: string, candidates: ExactSearchCandidate[]) {
  const assetIdByChunkId = new Map<string, GenericId<"documentAssets"> | undefined>()
  for (const candidate of candidates) {
    assetIdByChunkId.set(String(candidate.chunkId), candidate.assetId)
  }

  return rankExactCandidates(
    question,
    candidates.map(({ assetId: _assetId, ...candidate }) => candidate)
  )
    .slice(0, GLOBAL_EXACT_MATCH_LIMIT)
    .map((candidate) => {
      const chunkId = candidate.chunkId as GenericId<"chunks">
      const assetId = assetIdByChunkId.get(String(candidate.chunkId))

      return {
        ...candidate,
        chunkId,
        ...(assetId === undefined ? {} : { assetId })
      }
    })
}

async function insertExactTermsForChunkBatch(ctx: ExactTermInsertCtx, chunks: ExactTermBackfillChunk[]) {
  let inserted = 0

  for (const chunk of chunks) {
    const existingTerms = await ctx.db
      .query("chunkTerms")
      .withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id))
      .take(1)
    if (existingTerms.length > 0) {
      continue
    }

    for (const term of buildChunkTerms({ citationLabel: chunk.citationLabel, content: chunk.content })) {
      await ctx.db.insert("chunkTerms", {
        chunkId: chunk._id,
        documentId: chunk.documentId,
        term
      })
      inserted += 1
    }
  }

  return inserted
}

async function deleteExactTermsForChunkBatch(ctx: ExactTermCleanupCtx, chunks: ExactTermCleanupChunk[]) {
  let deleted = 0

  for (const chunk of chunks) {
    const existingTerms = await ctx.db
      .query("chunkTerms")
      .withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id))
      .collect()

    for (const term of existingTerms) {
      await ctx.db.delete("chunkTerms", term._id)
      deleted += 1
    }
  }

  return deleted
}

async function selectChunksWithoutExactTerms(ctx: ExactTermInsertCtx, chunks: ExactTermBackfillChunk[], limit: number) {
  const chunksWithoutTerms: ExactTermBackfillChunk[] = []

  for (const chunk of chunks) {
    const existingTerms = await ctx.db
      .query("chunkTerms")
      .withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id))
      .take(1)
    if (existingTerms.length > 0) {
      continue
    }

    chunksWithoutTerms.push(chunk)
    if (chunksWithoutTerms.length >= limit) {
      break
    }
  }

  return chunksWithoutTerms
}

export const backfillDocumentExactTermsBatch = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.id("ingestionJobs"),
    offset: v.optional(v.number()),
    phase: v.optional(v.union(v.literal(EXACT_TERM_BACKFILL_PHASE_CLEANUP), v.literal(EXACT_TERM_BACKFILL_PHASE_BACKFILL)))
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const offset = args.offset ?? 0
    const phase = args.phase ?? EXACT_TERM_BACKFILL_PHASE_CLEANUP

    if (phase === EXACT_TERM_BACKFILL_PHASE_CLEANUP) {
      const staleChunks = await ctx.db
        .query("chunks")
        .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", false))
        .collect()
      const chunkBatch = staleChunks.slice(offset, offset + EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE)

      await deleteExactTermsForChunkBatch(ctx, chunkBatch)

      if (offset + EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE < staleChunks.length) {
        await ctx.scheduler.runAfter(0, internal.search.backfillDocumentExactTermsBatch, {
          documentId: args.documentId,
          jobId: args.jobId,
          offset: offset + EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE,
          phase
        })
        return null
      }

      await ctx.scheduler.runAfter(0, internal.search.backfillDocumentExactTermsBatch, {
        documentId: args.documentId,
        jobId: args.jobId,
        offset: 0,
        phase: EXACT_TERM_BACKFILL_PHASE_BACKFILL
      })
      return null
    }

    const currentChunks = await ctx.db
      .query("chunks")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
      .collect()
    const jobChunks = currentChunks.filter((chunk) => chunk.ingestionJobId === args.jobId)
    if (jobChunks.length === 0 || jobChunks.length !== currentChunks.length) {
      await ctx.runMutation(internal.documents.markFailed, {
        documentId: args.documentId,
        errorMessage: "Exact-term indexing was superseded by a newer ingestion job.",
        jobId: args.jobId
      })
      return null
    }

    const chunkBatch = jobChunks.slice(offset, offset + EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE)

    await insertExactTermsForChunkBatch(ctx, chunkBatch)

    if (offset + EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE < jobChunks.length) {
      await ctx.scheduler.runAfter(0, internal.search.backfillDocumentExactTermsBatch, {
        documentId: args.documentId,
        jobId: args.jobId,
        offset: offset + EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE,
        phase
      })
      return null
    }

    await ctx.runMutation(internal.documents.markReady, { documentId: args.documentId })
    await ctx.runMutation(internal.ingestion.updateJobStatus, {
      jobId: args.jobId,
      status: "ready"
    })

    return null
  }
})

export const loadExactResults = internalQuery({
  args: {
    documentId: v.optional(v.id("documents")),
    exactContent: v.string()
  },
  returns: v.array(searchResultValidator),
  handler: async (ctx, args) => {
    const documentId = args.documentId
    if (!documentId) {
      return []
    }

    const document = await ctx.db.get(documentId)
    if (!document || document.status !== "ready") {
      return []
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", documentId).eq("isCurrent", true))
      .collect()

    return rankExactSearchResults(
      args.exactContent,
      chunks.map((chunk) => ({
        ...(document.sourceAssetId === undefined ? {} : { assetId: document.sourceAssetId }),
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber
      }))
    )
  }
})

export const loadGlobalExactResultsPage = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    page: v.array(exactSearchCandidateValidator)
  }),
  handler: async (ctx, args) => {
    const { continueCursor, isDone, page } = await ctx.db
      .query("chunks")
      .withIndex("by_current_and_content", (q) => q.eq("isCurrent", true))
      .paginate(args.paginationOpts)

    const candidates: ExactSearchCandidate[] = []
    for (const chunk of page) {
      const document = await ctx.db.get(chunk.documentId)
      if (!document || document.status !== "ready") {
        continue
      }

      candidates.push({
        ...(document.sourceAssetId === undefined ? {} : { assetId: document.sourceAssetId }),
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber
      })
    }

    return {
      continueCursor,
      isDone,
      page: candidates
    }
  }
})

export const loadSearchResults = internalQuery({
  args: {
    matches: v.array(
      v.object({
        _id: v.id("chunkEmbeddings"),
        _score: v.number()
      })
    )
  },
  returns: v.array(searchResultValidator),
  handler: async (ctx, args) => {
    const results: SearchResult[] = []

    for (const match of args.matches) {
      const embedding = await ctx.db.get(match._id)
      if (!embedding) {
        continue
      }
      if (!embedding.isCurrent) {
        continue
      }

      const chunk = await ctx.db.get(embedding.chunkId)
      if (!chunk) {
        continue
      }
      if (!chunk.isCurrent) {
        continue
      }

      const document = await ctx.db.get(embedding.documentId)
      if (!document) {
        continue
      }
      if (document.status !== "ready") {
        continue
      }

      results.push({
        assetId: document.sourceAssetId,
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        score: match._score
      })
    }

    return results
  }
})

export const saveEvidence = internalMutation({
  args: {
    evidence: v.array(savedEvidenceValidator),
    messageId: v.id("chatMessages")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const item of args.evidence) {
      const chunk = await ctx.db.get(item.chunkId)
      if (!chunk) {
        continue
      }

      await ctx.db.insert("answerEvidence", {
        documentId: chunk.documentId,
        assetId: item.assetId,
        chunkId: item.chunkId,
        messageId: args.messageId,
        pageNumber: item.pageNumber,
        score: item.score
      })
    }

    return null
  }
})

export const claimSearchAccess = internalMutation({
  args: { sessionId: v.optional(v.id("chatSessions")) },
  returns: searchRateLimitResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now()
    const windowStart = now - (now % SEARCH_RATE_WINDOW_MS)
    const retryAfterMs = Math.max(1, windowStart + SEARCH_RATE_WINDOW_MS - now)
    const states = await ctx.db.query("searchRateState").take(8)
    const [state, ...extraStates] = states
    for (const extraState of extraStates) {
      await ctx.db.delete("searchRateState", extraState._id)
    }

    const globalRequestCount = state && state.windowStart === windowStart ? state.globalRequestCount : 0
    const session = args.sessionId ? await ctx.db.get(args.sessionId) : null
    const sessionRequestCount = session && session.searchWindowStart === windowStart ? (session.searchRequestCount ?? 0) : 0

    if (globalRequestCount >= GLOBAL_SEARCH_REQUEST_LIMIT) {
      return {
        allowed: false,
        retryAfterMs
      }
    }

    if (args.sessionId && sessionRequestCount >= SESSION_SEARCH_REQUEST_LIMIT) {
      return {
        allowed: false,
        retryAfterMs
      }
    }

    const nextGlobalRequestCount = globalRequestCount + 1

    if (!state) {
      await ctx.db.insert("searchRateState", {
        globalRequestCount: nextGlobalRequestCount,
        windowStart
      })
    } else if (state.windowStart !== windowStart) {
      await ctx.db.patch("searchRateState", state._id, {
        globalRequestCount: nextGlobalRequestCount,
        windowStart
      })
    } else {
      await ctx.db.patch("searchRateState", state._id, {
        globalRequestCount: nextGlobalRequestCount,
        windowStart
      })
    }

    if (args.sessionId && session) {
      await ctx.db.patch("chatSessions", args.sessionId, {
        searchRequestCount: sessionRequestCount + 1,
        searchWindowStart: windowStart
      })
    }

    return { allowed: true }
  }
})

export const loadGlobalExactResultsByTerms = internalQuery({
  args: {
    question: v.string(),
    terms: v.array(v.string())
  },
  returns: v.array(searchResultValidator),
  handler: async (ctx, args) => {
    const seenChunkIds = new Set<string>()
    const candidates: ExactSearchCandidate[] = []

    for (const term of args.terms.slice(0, 12)) {
      const rows = await ctx.db
        .query("chunkTerms")
        .withIndex("by_term", (q) => q.eq("term", term))
        .take(GLOBAL_EXACT_TERM_LIMIT)

      for (const row of rows) {
        if (seenChunkIds.has(String(row.chunkId))) {
          continue
        }

        const chunk = await ctx.db.get(row.chunkId)
        if (!chunk?.isCurrent) {
          continue
        }

        const document = await ctx.db.get(chunk.documentId)
        if (!document || document.status !== "ready") {
          continue
        }

        seenChunkIds.add(String(chunk._id))
        candidates.push({
          ...(document.sourceAssetId === undefined ? {} : { assetId: document.sourceAssetId }),
          citationLabel: chunk.citationLabel,
          chunkId: chunk._id,
          content: chunk.content,
          pageNumber: chunk.pageNumber
        })
      }
    }

    return rankExactSearchResults(args.question, candidates)
  }
})

export const backfillExactTerms = mutation({
  args: { sessionToken: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireAdminWriteSession(ctx, args.sessionToken)

    const currentChunks = await ctx.db
      .query("chunks")
      .withIndex("by_current_and_content", (q) => q.eq("isCurrent", true))
      .collect()

    const chunkBatch = await selectChunksWithoutExactTerms(ctx, currentChunks, EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE)

    return await insertExactTermsForChunkBatch(ctx, chunkBatch)
  }
})

export const ask = action({
  args: {
    documentId: v.optional(v.id("documents")),
    question: v.string(),
    sessionAccessToken: v.optional(v.string()),
    sessionId: v.optional(v.id("chatSessions"))
  },
  returns: answerPacketValidator,
  handler: async (ctx, args): Promise<AnswerPacket> => {
    const question = args.question.trim()
    if (!question) {
      throw new ConvexError("Question is required")
    }
    const responseLanguage = detectQuestionLanguage(question)

    const shouldRotateSessionToken = args.sessionId !== undefined
    let sessionId = args.sessionId
    let sessionAccessToken = args.sessionAccessToken
    if (sessionId) {
      if (!sessionAccessToken) {
        throw new ConvexError("Session not found")
      }

      const session = await ctx.runQuery(internal.chats.getAuthorizedSession, { sessionAccessToken, sessionId })
      if (!session) {
        throw new ConvexError("Session not found")
      }
    }

    if (!sessionId) {
      const session = await ctx.runMutation(internal.chats.ensureSession, {
        title: question.slice(0, 80)
      })
      sessionId = session.sessionId
      sessionAccessToken = session.sessionAccessToken
    }

    const access = await ctx.runMutation(internal.search.claimSearchAccess, {
      sessionId
    })
    if (!access.allowed) {
      throw new ConvexError(
        `Too many search requests. Please wait ${Math.ceil((access.retryAfterMs ?? SEARCH_RATE_WINDOW_MS) / 1000)} seconds and try again.`
      )
    }

    if (!sessionId || !sessionAccessToken) {
      throw new ConvexError("Session not found")
    }

    await ctx.runMutation(internal.chats.appendMessage, {
      content: question,
      role: "user",
      sessionId
    })

    const { jinaKeyPool, providerEnv } = setupProviderKeyPool("Embedding", () => {
      const env = getProviderEnv()
      return {
        jinaKeyPool: buildProviderKeyPool(JINA_EMBEDDING_PROVIDER, env.jinaApiKeys),
        providerEnv: env
      }
    })
    const inceptionKeyPool = setupProviderKeyPool("Answer", () =>
      buildProviderKeyPool(INCEPTION_PROVIDER, providerEnv.inceptionApiKeys)
    )
    const jinaKeyId = await reserveProviderKey(
      ctx,
      {
        estimatedInputTokens: estimateTokenCount(question),
        estimatedOutputTokens: 0,
        inputTpmLimit: providerEnv.jinaTpmPerKey,
        keyIds: jinaKeyPool.map((key) => key.id),
        maxConcurrent: providerEnv.jinaMaxConcurrentPerKey,
        outputTpmLimit: providerEnv.jinaTpmPerKey,
        provider: JINA_EMBEDDING_PROVIDER,
        rpmLimit: providerEnv.jinaRpmPerKey
      },
      "Embedding"
    )
    const embedding = await (async () => {
      try {
        return await embedSearchQuery(question, {
          apiKey: resolveProviderKey(jinaKeyPool, jinaKeyId),
          keyId: jinaKeyId,
          model: providerEnv.jinaEmbedModel
        })
      } catch (error) {
        return await handleProviderFailure(ctx, {
          error,
          label: "Embedding",
          provider: JINA_EMBEDDING_PROVIDER,
          reservedKeyId: jinaKeyId
        })
      }
    })()
    await recordProviderSuccess(ctx, JINA_EMBEDDING_PROVIDER, jinaKeyId, "Embedding")

    const matches = await ctx.vectorSearch("chunkEmbeddings", "by_embedding", {
      filter: (q) => (args.documentId ? q.eq("documentCurrentKey", `${args.documentId}:current`) : q.eq("isCurrent", true)),
      limit: getVectorSearchLimit(args.documentId),
      vector: embedding
    })

    const evidence: SearchResult[] = await ctx.runQuery(internal.search.loadSearchResults, { matches })
    const shouldRunExactFallback = isLookupLikeQuery(question) || getTopEvidenceScore(evidence) < WEAK_VECTOR_EVIDENCE_THRESHOLD
    const exactEvidence: SearchResult[] = shouldRunExactFallback
      ? args.documentId
        ? await ctx.runQuery(internal.search.loadExactResults, {
            documentId: args.documentId,
            exactContent: question
          })
        : await (async () => {
            const terms = extractExactSearchTerms(question)
            const termMatches = terms.length
              ? await ctx.runQuery(internal.search.loadGlobalExactResultsByTerms, {
                  question,
                  terms
                })
              : []

            if (termMatches.length >= GLOBAL_EXACT_MATCH_LIMIT) {
              return termMatches
            }

            let cursor: string | null = null
            let isDone = false
            let remaining = GLOBAL_EXACT_MATCH_SCAN_LIMIT
            const candidates: ExactSearchCandidate[] = []

            while (!isDone && remaining > 0) {
              const numItems = Math.min(GLOBAL_EXACT_MATCH_PAGE_SIZE, remaining)
              const page: ExactSearchPage = await ctx.runQuery(internal.search.loadGlobalExactResultsPage, {
                paginationOpts: {
                  cursor,
                  numItems
                }
              })

              cursor = page.continueCursor
              isDone = page.isDone
              remaining -= numItems
              candidates.push(...page.page)
            }

            const paginatedMatches = rankExactSearchResults(question, candidates)
            return termMatches.length > 0 ? (mergeCandidates(termMatches, paginatedMatches) as SearchResult[]) : paginatedMatches
          })()
      : []

    const mergedEvidence = mergeCandidates(evidence, exactEvidence) as SearchResult[]
    const evidenceWithIds = mergedEvidence.map((item, index) => ({
      ...item,
      evidenceId: `E${index + 1}`
    }))
    if (mergedEvidence.length === 0) {
      const packet = buildRefusalPacket(sessionId, sessionAccessToken, responseLanguage)

      await ctx.runMutation(internal.chats.appendMessage, {
        answerabilityStatus: packet.answerabilityStatus,
        content: packet.answerSummary,
        role: "assistant",
        sessionId
      })

      if (shouldRotateSessionToken) {
        packet.sessionAccessToken = (
          await ctx.runMutation(internal.chats.rotateSessionAccessToken, { sessionAccessToken, sessionId })
        ).sessionAccessToken
      }

      return packet
    }

    const context = evidenceWithIds.map((item) => `[${item.evidenceId}] ${item.citationLabel}: ${item.content}`).join("\n\n")
    const inceptionEstimatedInputTokens = estimateTokenCount(`${question}\n\n${context}`)
    const inceptionEstimatedOutputTokens = Math.max(
      1,
      Math.min(providerEnv.inceptionMaxTokens, providerEnv.inceptionEstimatedOutputTokens)
    )
    const inceptionKeyId = await reserveProviderKey(
      ctx,
      {
        estimatedInputTokens: inceptionEstimatedInputTokens,
        estimatedOutputTokens: inceptionEstimatedOutputTokens,
        inputTpmLimit: providerEnv.inceptionInputTpmPerKey,
        keyIds: inceptionKeyPool.map((key) => key.id),
        maxConcurrent: providerEnv.inceptionMaxConcurrentPerKey,
        outputTpmLimit: providerEnv.inceptionOutputTpmPerKey,
        provider: INCEPTION_PROVIDER,
        rpmLimit: providerEnv.inceptionRpmPerKey
      },
      "Answer"
    )
    const groundedAnswer = await (async () => {
      try {
        return await generateGroundedAnswer(question, context, responseLanguage, {
          apiKey: resolveProviderKey(inceptionKeyPool, inceptionKeyId),
          baseUrl: providerEnv.inceptionBaseUrl,
          keyId: inceptionKeyId,
          maxTokens: providerEnv.inceptionMaxTokens,
          model: providerEnv.inceptionChatModel,
          reasoningEffort: providerEnv.inceptionReasoningEffort,
          temperature: providerEnv.inceptionTemperature
        })
      } catch (error) {
        return await handleProviderFailure(ctx, {
          error,
          label: "Answer",
          provider: INCEPTION_PROVIDER,
          reservedKeyId: inceptionKeyId
        })
      }
    })()
    const inceptionOutputTokens = groundedAnswer.usage?.outputTokens ?? estimateGroundedAnswerOutputTokens(groundedAnswer)
    await recordProviderSuccess(ctx, INCEPTION_PROVIDER, inceptionKeyId, "Answer", {
      ...(groundedAnswer.usage?.inputTokens === undefined ? {} : { inputTokens: groundedAnswer.usage.inputTokens }),
      outputTokens: inceptionOutputTokens,
      reservedInputTokens: inceptionEstimatedInputTokens,
      reservedOutputTokens: inceptionEstimatedOutputTokens
    })
    const selectedEvidence = selectEvidenceByCitationIds(evidenceWithIds, groundedAnswer.citationIds)
    const packet: AnswerPacket =
      groundedAnswer.answerSteps.length === 0 || selectedEvidence.length === 0
        ? buildRefusalPacket(sessionId, sessionAccessToken, responseLanguage)
        : buildGroundedPacket(
            sessionId,
            sessionAccessToken,
            groundedAnswer.answerSummary,
            groundedAnswer.answerSteps,
            selectedEvidence
          )

    const assistantMessageId = await ctx.runMutation(internal.chats.appendMessage, {
      answerabilityStatus: packet.answerabilityStatus,
      content: packet.answerSummary,
      role: "assistant",
      sessionId
    })

    if (packet.answerabilityStatus === "grounded") {
      await ctx.runMutation(internal.search.saveEvidence, {
        evidence: selectedEvidence.map((item) =>
          item.assetId === undefined
            ? {
                chunkId: item.chunkId,
                pageNumber: item.pageNumber,
                score: item.score
              }
            : {
                assetId: item.assetId,
                chunkId: item.chunkId,
                pageNumber: item.pageNumber,
                score: item.score
              }
        ),
        messageId: assistantMessageId
      })
    }

    if (shouldRotateSessionToken) {
      packet.sessionAccessToken = (
        await ctx.runMutation(internal.chats.rotateSessionAccessToken, { sessionAccessToken, sessionId })
      ).sessionAccessToken
    }

    return packet
  }
})
