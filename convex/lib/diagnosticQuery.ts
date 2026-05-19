export type DiagnosticIntent =
  | "lookup"
  | "installation_help"
  | "troubleshooting"
  | "wiring"
  | "configuration"
  | "specification"
  | "comparison"
  | "unknown"

export type DiagnosticSeverity = "informational" | "operational" | "safety-critical"

export type DiagnosticStage = "installation" | "first_power_on" | "commissioning" | "operation" | "maintenance" | "unknown"

export type MissingDiagnosticContext = "vendor" | "model"

export type DiagnosticDocumentScope = {
  documentId: string
  language: string
  productSlug: string
  title: string
  vendorSlug: string
  version: string
}

export type DiagnosticQueryUnderstanding = {
  intent: DiagnosticIntent
  interpretedProblem: string
  literalIdentifiers: string[]
  missingContext: MissingDiagnosticContext[]
  needsClarification: boolean
  productCategory: string | null
  resolvedScope: DiagnosticDocumentScope | null
  severity: DiagnosticSeverity
  stage: DiagnosticStage
  symptoms: string
}

export type ClarificationPromptInput = {
  interpretedProblem: string
  missingContext: MissingDiagnosticContext[]
}

const DIAGNOSTIC_KEYWORDS = [
  "alarm",
  "commission",
  "commissioning",
  "drive",
  "error",
  "fault",
  "install",
  "instal",
  "installation",
  "inverter",
  "motor",
  "parameter",
  "power on",
  "troubleshoot",
  "wiring"
]

const COMPARISON_KEYWORDS = ["bandingkan", "compare", "comparison", "difference", "perbedaan", "versus", "vs"]
const WIRING_KEYWORDS = ["terminal", "wire", "wiring", "kabel", "pengkabelan"]
const CONFIGURATION_KEYWORDS = ["config", "configure", "konfigurasi", "parameter", "setting"]
const INSTALLATION_KEYWORDS = ["install", "instal", "installation", "mount", "pasang"]
const FIRST_POWER_ON_KEYWORDS = ["first power", "first power on", "power on", "startup", "start-up"]
const DRIVE_KEYWORDS = ["drive", "inverter", "vfd"]
const OPERATIONAL_COMPONENT_KEYWORDS = ["drive", "inverter", "motor", "vfd"]
const OPERATIONAL_SYMPTOM_KEYWORDS = [
  "belum jalan",
  "belum start",
  "does not run",
  "does not start",
  "failed to start",
  "fails to start",
  "gagal jalan",
  "gagal start",
  "no output",
  "not moving",
  "not running",
  "not starting",
  "tidak bergerak",
  "tidak berputar",
  "tidak jalan",
  "tidak menyala",
  "tidak start",
  "will not run",
  "will not start",
  "won't run",
  "won't start"
]
function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{Pd}_/]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function includesAny(normalizedQuestion: string, keywords: string[]) {
  const questionTokens = tokenizeNormalized(normalizedQuestion)
  return keywords.some((keyword) => hasTokenSequence(questionTokens, tokenizeNormalized(normalize(keyword))))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function tokenizeNormalized(normalizedValue: string) {
  return normalizedValue.split(" ").filter(Boolean)
}

function hasTokenSequence(tokens: string[], sequence: string[]) {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false
  }

  return tokens.some((_, index) => sequence.every((sequenceToken, offset) => tokens[index + offset] === sequenceToken))
}

function slugMatchesQuestion(slug: string, normalizedQuestion: string) {
  return hasTokenSequence(tokenizeNormalized(normalizedQuestion), tokenizeNormalized(normalize(slug)))
}

function scopeVendorMatchesQuestion(scope: DiagnosticDocumentScope, normalizedQuestion: string) {
  return slugMatchesQuestion(scope.vendorSlug, normalizedQuestion)
}

function scopeProductMatchesQuestion(scope: DiagnosticDocumentScope, normalizedQuestion: string) {
  return slugMatchesQuestion(scope.productSlug, normalizedQuestion)
}

function hasOperationalSymptomNarrative(normalizedQuestion: string) {
  const hasOperationalContext =
    includesAny(normalizedQuestion, OPERATIONAL_COMPONENT_KEYWORDS) || includesAny(normalizedQuestion, FIRST_POWER_ON_KEYWORDS)

  return hasOperationalContext && includesAny(normalizedQuestion, OPERATIONAL_SYMPTOM_KEYWORDS)
}

export function extractLiteralIdentifiers(question: string) {
  const matches = question.matchAll(/(?:^|[^\p{L}\p{N}])([A-Z]{1,8}-?\d[A-Z0-9-]{0,12})(?=$|[^\p{L}\p{N}])/giu)
  return unique([...matches].map((match) => match[1].toUpperCase()))
}

function detectIntent(question: string): DiagnosticIntent {
  const normalizedQuestion = normalize(question)
  const literalIdentifiers = extractLiteralIdentifiers(question)
  const hasFaultCodeIdentifier = literalIdentifiers.some((identifier) => /^[FE]-?\d/i.test(identifier))
  if (includesAny(normalizedQuestion, COMPARISON_KEYWORDS)) {
    return "comparison"
  }

  if (includesAny(normalizedQuestion, WIRING_KEYWORDS)) {
    return "wiring"
  }

  if (includesAny(normalizedQuestion, CONFIGURATION_KEYWORDS)) {
    return "configuration"
  }

  if (includesAny(normalizedQuestion, INSTALLATION_KEYWORDS)) {
    return literalIdentifiers.length > 0 ? "troubleshooting" : "installation_help"
  }

  if (/\b(error|fault|alarm|trip|kode|code|muncul)\b/i.test(question)) {
    return "troubleshooting"
  }

  if (hasFaultCodeIdentifier) {
    return "troubleshooting"
  }

  if (hasOperationalSymptomNarrative(normalizedQuestion)) {
    return "troubleshooting"
  }

  if (literalIdentifiers.length > 0 && includesAny(normalizedQuestion, FIRST_POWER_ON_KEYWORDS)) {
    return "troubleshooting"
  }

  return literalIdentifiers.length > 0 ? "lookup" : "unknown"
}

function detectSeverity(intent: DiagnosticIntent) {
  if (intent === "wiring") {
    return "safety-critical" as const
  }

  if (intent === "installation_help" || intent === "troubleshooting" || intent === "configuration") {
    return "operational" as const
  }

  return "informational" as const
}

function detectStage(question: string): DiagnosticStage {
  const normalizedQuestion = normalize(question)
  if (includesAny(normalizedQuestion, FIRST_POWER_ON_KEYWORDS)) {
    return "first_power_on"
  }

  if (includesAny(normalizedQuestion, INSTALLATION_KEYWORDS)) {
    return "installation"
  }

  if (includesAny(normalizedQuestion, ["commission", "commissioning"])) {
    return "commissioning"
  }

  if (includesAny(normalizedQuestion, ["maintenance", "perawatan"])) {
    return "maintenance"
  }

  if (includesAny(normalizedQuestion, ["operation", "operasi"])) {
    return "operation"
  }

  return "unknown"
}

function detectProductCategory(question: string) {
  return includesAny(normalize(question), DRIVE_KEYWORDS) ? "drive" : null
}

function resolveScope(question: string, scopes: DiagnosticDocumentScope[]) {
  const normalizedQuestion = normalize(question)
  const productMatches = scopes.filter((scope) => scopeProductMatchesQuestion(scope, normalizedQuestion))
  const vendorAndProductMatch = productMatches.find((scope) => scopeVendorMatchesQuestion(scope, normalizedQuestion))

  return vendorAndProductMatch ?? (productMatches.length === 1 ? productMatches[0] : null)
}

function hasKnownVendor(question: string, scopes: DiagnosticDocumentScope[]) {
  const normalizedQuestion = normalize(question)
  return scopes.some((scope) => scopeVendorMatchesQuestion(scope, normalizedQuestion))
}

export function hasDiagnosticSignals(question: string) {
  const normalizedQuestion = normalize(question)
  return extractLiteralIdentifiers(question).length > 0 || includesAny(normalizedQuestion, DIAGNOSTIC_KEYWORDS)
}

export function understandDiagnosticQuery(
  question: string,
  scopes: DiagnosticDocumentScope[] = []
): DiagnosticQueryUnderstanding {
  const trimmedQuestion = question.trim()
  const intent = detectIntent(trimmedQuestion)
  const severity = detectSeverity(intent)
  const stage = detectStage(trimmedQuestion)
  const literalIdentifiers = extractLiteralIdentifiers(trimmedQuestion)
  const resolvedScope = intent === "comparison" ? null : resolveScope(trimmedQuestion, scopes)
  const productCategory = detectProductCategory(trimmedQuestion)
  const requiresScopedContext = intent !== "comparison" && (severity === "operational" || severity === "safety-critical")
  const missingContext: MissingDiagnosticContext[] = []
  const hasVendorContext = Boolean(resolvedScope) || hasKnownVendor(trimmedQuestion, scopes)
  const hasModelContext = Boolean(resolvedScope)

  if (requiresScopedContext && !hasVendorContext) {
    missingContext.push("vendor")
  }

  if (requiresScopedContext && !hasModelContext) {
    missingContext.push("model")
  }

  return {
    intent,
    interpretedProblem: trimmedQuestion,
    literalIdentifiers,
    missingContext,
    needsClarification: missingContext.length > 0,
    productCategory,
    resolvedScope,
    severity,
    stage,
    symptoms: trimmedQuestion
  }
}

export function buildClarificationPromptInput(context: DiagnosticQueryUnderstanding): ClarificationPromptInput {
  return {
    interpretedProblem: context.interpretedProblem,
    missingContext: context.missingContext
  }
}
