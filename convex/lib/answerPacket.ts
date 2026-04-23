import type { GenericId } from "convex/values"

import { v } from "convex/values"

import { answerabilityStatusValidator } from "./validators"

export type AnswerCitation = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  pageNumber: number
}

export type SupportingAsset = {
  assetId: GenericId<"documentAssets">
  label: string
  pageNumber: number
}

export type AnswerPacket = {
  answerSteps: string[]
  answerSummary: string
  answerabilityStatus: "grounded" | "insufficient_evidence"
  citations: AnswerCitation[]
  sessionId: GenericId<"chatSessions">
  supportingAssets: SupportingAsset[]
}

type Evidence = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  evidenceId?: string
  pageNumber: number
  score: number
}

export const answerCitationValidator = v.object({
  assetId: v.optional(v.id("documentAssets")),
  citationLabel: v.string(),
  chunkId: v.id("chunks"),
  pageNumber: v.number()
})

export const supportingAssetValidator = v.object({
  assetId: v.id("documentAssets"),
  label: v.string(),
  pageNumber: v.number()
})

export const answerPacketValidator = v.object({
  answerSteps: v.array(v.string()),
  answerSummary: v.string(),
  answerabilityStatus: answerabilityStatusValidator,
  citations: v.array(answerCitationValidator),
  sessionId: v.id("chatSessions"),
  supportingAssets: v.array(supportingAssetValidator)
})

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>()
  const unique: T[] = []

  for (const item of items) {
    const itemKey = key(item)
    if (seen.has(itemKey)) {
      continue
    }

    seen.add(itemKey)
    unique.push(item)
  }

  return unique
}

function normalizeCitationId(value: string) {
  return value.trim().replace(/^\[+|\]+$/g, "").toUpperCase()
}

export function buildRefusalPacket(
  sessionId: GenericId<"chatSessions">,
  answerSummary = "I could not find enough evidence in the official documentation to answer that safely.",
  answerSteps: string[] = []
): AnswerPacket {
  return {
    answerSteps,
    answerSummary,
    answerabilityStatus: "insufficient_evidence",
    citations: [],
    sessionId,
    supportingAssets: []
  }
}

export function selectEvidenceByCitationIds(evidence: Evidence[], citationIds: string[]) {
  const wanted = new Set(citationIds.map(normalizeCitationId).filter(Boolean))
  return evidence.filter((item) => item.evidenceId !== undefined && wanted.has(normalizeCitationId(item.evidenceId)))
}

export function buildGroundedPacket(
  sessionId: GenericId<"chatSessions">,
  answerSummary: string,
  answerSteps: string[],
  evidence: Evidence[]
): AnswerPacket {
  // v1 keeps evidence page-based: citations open the source PDF page instead of
  // rendering extracted MinerU image assets inline in the answer packet.
  const citations = uniqueBy(evidence, (item) => item.chunkId).map((item) => ({
    ...(item.assetId === undefined ? {} : { assetId: item.assetId }),
    citationLabel: item.citationLabel,
    chunkId: item.chunkId,
    pageNumber: item.pageNumber
  }))

  const supportingAssets = uniqueBy(
    evidence.filter((item): item is Evidence & { assetId: GenericId<"documentAssets"> } => item.assetId !== undefined),
    (item) => `${item.pageNumber}:${item.assetId}`
  ).map((item) => ({
    assetId: item.assetId,
    label: item.citationLabel,
    pageNumber: item.pageNumber
  }))

  return {
    answerSteps,
    answerSummary,
    answerabilityStatus: "grounded",
    citations,
    sessionId,
    supportingAssets
  }
}
