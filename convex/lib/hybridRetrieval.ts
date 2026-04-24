export type HybridCandidate = {
  citationLabel: string
  chunkId: string
  content: string
  pageNumber: number
  score: number
}

type CandidateInput = Omit<HybridCandidate, "score">

const LOOKUP_OPENERS = new Set([
  "how",
  "what",
  "when",
  "where",
  "why",
  "who",
  "which",
  "can",
  "could",
  "do",
  "does",
  "did",
  "is",
  "are",
  "am",
  "was",
  "were",
  "should",
  "would",
  "will"
])

const COMMON_ACTION_PREFIXES = new Set([
  "adjust",
  "analyze",
  "disable",
  "close",
  "compare",
  "create",
  "configure",
  "check",
  "determine",
  "delete",
  "diagnose",
  "edit",
  "enable",
  "examine",
  "explain",
  "explore",
  "find",
  "fix",
  "install",
  "inspect",
  "investigate",
  "locate",
  "make",
  "open",
  "perform",
  "prepare",
  "print",
  "read",
  "reset",
  "remove",
  "run",
  "research",
  "review",
  "search",
  "select",
  "set",
  "save",
  "scan",
  "show",
  "please",
  "start",
  "stop",
  "study",
  "tell",
  "use",
  "verify",
  "troubleshoot",
  "view",
  "work",
  "update"
])

const COMMON_NOUN_PREFIXES = new Set([
  "customer",
  "console",
  "health",
  "history",
  "logging",
  "manual",
  "methods",
  "number",
  "numbers",
  "invoice",
  "order",
  "payment",
  "notes",
  "project",
  "release",
  "report",
  "service",
  "services",
  "system",
  "status",
  "success",
  "systems",
  "guide",
  "guides",
  "support",
  "license",
  "licenses",
  "settings"
])

const MAX_LOOKUP_TOKENS = 6
const MAX_LOOKUP_CHARS = 48
const MIN_TITLECASE_LAST_TOKEN_LENGTH = 5

function normalizeForComparison(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

function extractTokens(value: string) {
  return normalizeForComparison(value)
    .split(" ")
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0)
}

function extractOriginalTokens(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function hasQuotedPhrase(value: string) {
  return /["“”'][^"“”']+["“”']/.test(value)
}

function isIdentifierLikeToken(token: string) {
  return /[\p{L}\p{N}]/u.test(token) && /[\d-]/.test(token) && token.length >= 2
}

function isSimpleTitleCaseToken(token: string) {
  return /^\p{Lu}[\p{Ll}\p{M}\p{N}\-_/]*$/u.test(token)
}

function isAcronymToken(token: string) {
  return /^\p{Lu}{2,}$/u.test(token)
}

function isQuestionWordStart(question: string) {
  const firstWord = extractTokens(question)[0]
  return firstWord ? LOOKUP_OPENERS.has(firstWord) : false
}

function compareStrings(left: string, right: string) {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

function compareCandidateOrder(
  left: Pick<HybridCandidate, "citationLabel" | "chunkId" | "content" | "pageNumber">,
  right: Pick<HybridCandidate, "citationLabel" | "chunkId" | "content" | "pageNumber">
) {
  if (left.pageNumber !== right.pageNumber) {
    return left.pageNumber - right.pageNumber
  }

  if (left.citationLabel !== right.citationLabel) {
    return compareStrings(left.citationLabel, right.citationLabel)
  }

  if (left.chunkId !== right.chunkId) {
    return compareStrings(left.chunkId, right.chunkId)
  }

  return 0
}

function isLiteralMatch(question: string, candidate: CandidateInput) {
  const normalizedQuestion = normalizeForComparison(question)
  if (!normalizedQuestion) {
    return false
  }

  return (
    containsExactPhrase(normalizeForComparison(candidate.content), normalizedQuestion) ||
    containsExactPhrase(normalizeForComparison(candidate.citationLabel), normalizedQuestion)
  )
}

function containsExactPhrase(haystack: string, needle: string) {
  const haystackTokens = haystack.split(" ").map(normalizeToken).filter(Boolean)
  const needleTokens = needle.split(" ").map(normalizeToken).filter(Boolean)

  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) {
    return false
  }

  for (let start = 0; start <= haystackTokens.length - needleTokens.length; start += 1) {
    let matches = true
    for (let offset = 0; offset < needleTokens.length; offset += 1) {
      if (haystackTokens[start + offset] !== needleTokens[offset]) {
        matches = false
        break
      }
    }

    if (matches) {
      return true
    }
  }

  return false
}

export function isLookupLikeQuery(question: string) {
  const trimmed = question.trim()
  if (!trimmed) {
    return false
  }

  const tokens = extractTokens(trimmed)
  const originalTokens = extractOriginalTokens(trimmed)

  if (
    hasQuotedPhrase(trimmed) &&
    tokens.length <= 6 &&
    !isQuestionWordStart(trimmed) &&
    !COMMON_ACTION_PREFIXES.has(tokens[0] ?? "")
  ) {
    return true
  }

  if (
    tokens.length <= MAX_LOOKUP_TOKENS &&
    tokens.some(isIdentifierLikeToken) &&
    !isQuestionWordStart(trimmed) &&
    !trimmed.endsWith("?") &&
    !COMMON_ACTION_PREFIXES.has(tokens[0] ?? "")
  ) {
    return true
  }

  if (
    trimmed.length <= MAX_LOOKUP_CHARS &&
    originalTokens.length <= 4 &&
    !trimmed.endsWith("?") &&
    !isQuestionWordStart(trimmed) &&
    originalTokens.every((token) => isSimpleTitleCaseToken(token) || isAcronymToken(token) || isIdentifierLikeToken(token)) &&
    !COMMON_ACTION_PREFIXES.has(originalTokens[0]?.toLowerCase() ?? "") &&
    !COMMON_NOUN_PREFIXES.has(originalTokens[0]?.toLowerCase() ?? "") &&
    (originalTokens.some((token) => /[\d-]/.test(token)) ||
      originalTokens.some(isAcronymToken) ||
      (originalTokens.at(-1)?.length ?? 0) >= MIN_TITLECASE_LAST_TOKEN_LENGTH)
  ) {
    return true
  }

  return false
}

export function rankExactCandidates(question: string, candidates: CandidateInput[]) {
  return candidates
    .filter((candidate) => isLiteralMatch(question, candidate))
    .map((candidate) => ({
      ...candidate,
      score: containsExactPhrase(normalizeForComparison(candidate.content), normalizeForComparison(question)) ? 1 : 0.95
    }))
    .sort((left, right) => right.score - left.score || compareCandidateOrder(left, right))
}

export function mergeCandidates(vectorCandidates: HybridCandidate[], exactCandidates: HybridCandidate[]) {
  type MergedCandidate = HybridCandidate & { source: "vector" | "exact" }

  const merged = new Map<string, MergedCandidate>()

  for (const candidate of [
    ...vectorCandidates.map((item) => ({ ...item, source: "vector" as const })),
    ...exactCandidates.map((item) => ({ ...item, source: "exact" as const }))
  ]) {
    const existing = merged.get(candidate.chunkId)
    const normalizedCandidate = candidate
    if (
      !existing ||
      normalizedCandidate.score > existing.score ||
      (normalizedCandidate.score === existing.score && normalizedCandidate.source === "exact" && existing.source === "vector") ||
      (normalizedCandidate.score === existing.score &&
        normalizedCandidate.source === existing.source &&
        compareCandidateOrder(normalizedCandidate, existing) < 0)
    ) {
      merged.set(candidate.chunkId, normalizedCandidate)
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      const sourceWeight = (source: MergedCandidate["source"]) => (source === "exact" ? 1 : 0)

      return (
        right.score - left.score || sourceWeight(right.source) - sourceWeight(left.source) || compareCandidateOrder(left, right)
      )
    })
    .map(({ source, ...candidate }) => candidate)
}
