import type { QuestionLanguage } from "./questionLanguage"
import type { GenericId } from "convex/values"

import { v } from "convex/values"

import { getRefusalSummaryForLanguage } from "./questionLanguage"
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
  sessionAccessToken: string
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
  sessionAccessToken: v.string(),
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
  return value
    .trim()
    .replace(/^\[+|\]+$/g, "")
    .toUpperCase()
}

export function buildRefusalPacket(
  sessionId: GenericId<"chatSessions">,
  sessionAccessToken: string,
  language: QuestionLanguage = { code: "en", instruction: "Answer in English." },
  answerSteps: string[] = []
): AnswerPacket {
  return {
    answerSteps,
    answerSummary: getRefusalSummaryForLanguage(language),
    answerabilityStatus: "insufficient_evidence",
    citations: [],
    sessionAccessToken,
    sessionId,
    supportingAssets: []
  }
}

export function selectEvidenceByCitationIds(evidence: Evidence[], citationIds: string[]) {
  const evidenceById = new Map<string, Evidence>()

  for (const item of evidence) {
    if (item.evidenceId === undefined) {
      continue
    }

    const normalizedId = normalizeCitationId(item.evidenceId)
    if (!evidenceById.has(normalizedId)) {
      evidenceById.set(normalizedId, item)
    }
  }

  const selected: Evidence[] = []
  const seen = new Set<string>()

  for (const citationId of citationIds) {
    const normalizedId = normalizeCitationId(citationId)
    if (!normalizedId || seen.has(normalizedId)) {
      continue
    }

    seen.add(normalizedId)
    const item = evidenceById.get(normalizedId)
    if (item) {
      selected.push(item)
    }
  }

  return selected
}

export function buildGroundedPacket(
  sessionId: GenericId<"chatSessions">,
  sessionAccessToken: string,
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
    sessionAccessToken,
    sessionId,
    supportingAssets
  }
}
