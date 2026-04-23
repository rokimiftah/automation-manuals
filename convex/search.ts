import type { AnswerPacket } from "./lib/answerPacket"
import type { GenericId } from "convex/values"

import { ConvexError, v } from "convex/values"

import { api, internal } from "./_generated/api"
import { action, internalMutation, internalQuery } from "./_generated/server"
import { answerPacketValidator, buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./lib/answerPacket"
import { embedTexts, generateGroundedAnswer } from "./lib/mistral"

type SearchResult = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  content: string
  pageNumber: number
  score: number
}

const searchResultValidator = v.object({
  assetId: v.optional(v.id("documentAssets")),
  citationLabel: v.string(),
  chunkId: v.id("chunks"),
  content: v.string(),
  pageNumber: v.number(),
  score: v.number()
})

const savedEvidenceValidator = v.object({
  assetId: v.optional(v.id("documentAssets")),
  chunkId: v.id("chunks"),
  pageNumber: v.number(),
  score: v.number()
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
      if (!document.isActive) {
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
      await ctx.db.insert("answerEvidence", {
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
          filter: (q) => (args.documentId ? q.eq("documentId", args.documentId) : q.eq("isCurrent", true)),
          limit: 6,
          vector: embedding
        })
      : []

    const evidence: SearchResult[] = await ctx.runQuery(internal.search.loadSearchResults, { matches })
    const evidenceWithIds = evidence.map((item, index) => ({
      ...item,
      evidenceId: `E${index + 1}`
    }))
    const topScore = matches[0]?._score ?? 0

    if (evidence.length === 0 || topScore < 0.55) {
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
