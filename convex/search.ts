import type { MutationCtx } from "./_generated/server"
import type { AnswerPacket } from "./lib/answerPacket"
import type { GenericId } from "convex/values"

import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import { action, internalMutation, internalQuery, mutation } from "./_generated/server"
import { requireAdminWriteSession } from "./lib/adminSession"
import { answerPacketValidator, buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./lib/answerPacket"
import { buildChunkTerms, extractExactSearchTerms } from "./lib/exactTerms"
import { isLookupLikeQuery, mergeCandidates, rankExactCandidates } from "./lib/hybridRetrieval"
import { embedTexts, generateGroundedAnswer } from "./lib/mistral"
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

export function getVectorSearchLimit(documentId?: GenericId<"documents">) {
  return documentId ? DOCUMENT_SCOPED_VECTOR_LIMIT : DEFAULT_VECTOR_LIMIT
}

export function getTopEvidenceScore(evidence: Array<{ score: number }>) {
  return evidence.reduce((topScore, item) => Math.max(topScore, item.score), 0)
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

    if (args.sessionId && sessionRequestCount >= SESSION_SEARCH_REQUEST_LIMIT) {
      return {
        allowed: false,
        retryAfterMs
      }
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

    return await insertExactTermsForChunkBatch(ctx, currentChunks.slice(0, EXACT_TERM_BACKFILL_CHUNK_BATCH_SIZE))
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

    const [embedding] = await embedTexts([question])
    const matches = embedding
      ? await ctx.vectorSearch("chunkEmbeddings", "by_embedding", {
          filter: (q) => (args.documentId ? q.eq("documentCurrentKey", `${args.documentId}:current`) : q.eq("isCurrent", true)),
          limit: getVectorSearchLimit(args.documentId),
          vector: embedding
        })
      : []

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
    const groundedAnswer = await generateGroundedAnswer(question, context, responseLanguage)
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
