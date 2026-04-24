import type { AnswerPacket } from "./lib/answerPacket"
import type { GenericId } from "convex/values"

import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { api, internal } from "./_generated/api"
import { action, internalMutation, internalQuery } from "./_generated/server"
import { answerPacketValidator, buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./lib/answerPacket"
import { isLookupLikeQuery, mergeCandidates, rankExactCandidates } from "./lib/hybridRetrieval"
import { embedTexts, generateGroundedAnswer } from "./lib/mistral"

type SearchResult = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  content: string
  pageNumber: number
  score: number
}

type ExactSearchCandidate = Omit<SearchResult, "score">

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

export const ask = action({
  args: {
    documentId: v.optional(v.id("documents")),
    question: v.string(),
    sessionId: v.optional(v.id("chatSessions"))
  },
  returns: answerPacketValidator,
  handler: async (ctx, args): Promise<AnswerPacket> => {
    const question = args.question.trim()
    if (!question) {
      throw new ConvexError("Question is required")
    }

    let sessionId = args.sessionId
    if (sessionId) {
      const session = await ctx.runQuery(api.chats.getSession, { sessionId })
      if (!session) {
        throw new ConvexError("Session not found")
      }
    } else {
      sessionId = await ctx.runMutation(internal.chats.ensureSession, {
        title: question.slice(0, 80)
      })
    }

    if (!sessionId) {
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

            return rankExactSearchResults(question, candidates)
          })()
      : []

    const mergedEvidence = mergeCandidates(evidence, exactEvidence) as SearchResult[]
    const evidenceWithIds = mergedEvidence.map((item, index) => ({
      ...item,
      evidenceId: `E${index + 1}`
    }))
    if (mergedEvidence.length === 0) {
      const packet = buildRefusalPacket(sessionId)

      await ctx.runMutation(internal.chats.appendMessage, {
        answerabilityStatus: packet.answerabilityStatus,
        content: packet.answerSummary,
        role: "assistant",
        sessionId
      })

      return packet
    }

    const context = evidenceWithIds.map((item) => `[${item.evidenceId}] ${item.citationLabel}: ${item.content}`).join("\n\n")
    const groundedAnswer = await generateGroundedAnswer(question, context)
    const selectedEvidence = selectEvidenceByCitationIds(evidenceWithIds, groundedAnswer.citationIds)
    const packet: AnswerPacket =
      groundedAnswer.answerSteps.length === 0 || selectedEvidence.length === 0
        ? buildRefusalPacket(sessionId)
        : buildGroundedPacket(sessionId, groundedAnswer.answerSummary, groundedAnswer.answerSteps, selectedEvidence)

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

    return packet
  }
})
