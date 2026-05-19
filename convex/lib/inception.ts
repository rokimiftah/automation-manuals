import type { ResponseLanguagePolicy } from "./questionLanguage"

import { getProviderEnv } from "./env"
import {
  parseRetryAfterMs,
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./providerErrors"

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>
type InceptionReasoningEffort = "instant" | "low" | "medium" | "high"

type InceptionOptions = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchImpl
  keyId?: string
  maxTokens?: number
  model?: string
  reasoningEffort?: InceptionReasoningEffort
  temperature?: number
}

type ResolvedOptions = {
  apiKey: string
  baseUrl: string
  fetchImpl: FetchImpl
  keyId: string
  maxTokens: number
  model: string
  reasoningEffort: InceptionReasoningEffort
  temperature: number
}

type ProviderEnv = ReturnType<typeof getProviderEnv>

type GroundedAnswer = {
  answerSteps: string[]
  answerSummary: string
  citationIds: string[]
  usage?: ProviderTokenUsage
}

type ChatMessage = {
  content: string
  role: "system" | "user"
}

type StructuredCompletionRequest = {
  messages: ChatMessage[]
  options: InceptionOptions
  schema: unknown
  schemaName: string
}

type StructuredCompletion = {
  content: unknown
  usage?: ProviderTokenUsage
}

type ProviderTokenUsage = {
  inputTokens?: number
  outputTokens?: number
}

const INCEPTION_PROVIDER = "inception"
const DEFAULT_BASE_URL = "https://api.inceptionlabs.ai/v1"
const DEFAULT_MODEL = "mercury-2"
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_REASONING_EFFORT = "low"
const DEFAULT_TEMPERATURE = 0.75

const GROUNDED_ANSWER_SCHEMA = {
  additionalProperties: false,
  properties: {
    answerSteps: {
      items: { type: "string" },
      type: "array"
    },
    answerSummary: { type: "string" },
    citationIds: {
      items: { type: "string" },
      type: "array"
    }
  },
  required: ["answerSummary", "answerSteps", "citationIds"],
  type: "object"
}

const INSUFFICIENT_EVIDENCE_SCHEMA = {
  additionalProperties: false,
  properties: { answerSummary: { type: "string" } },
  required: ["answerSummary"],
  type: "object"
} as const

const CLARIFYING_QUESTION_SCHEMA = {
  additionalProperties: false,
  properties: { clarifyingQuestion: { type: "string" } },
  required: ["clarifyingQuestion"],
  type: "object"
} as const

function collectTextFromPart(part: unknown) {
  if (!part || typeof part !== "object") {
    return typeof part === "string" ? part : ""
  }

  if (typeof (part as { text?: unknown }).text === "string") {
    return (part as { text: string }).text
  }

  if (typeof (part as { content?: unknown }).content === "string") {
    return (part as { content: string }).content
  }

  if (typeof (part as { value?: unknown }).value === "string") {
    return (part as { value: string }).value
  }

  return ""
}

export function extractTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content.map(collectTextFromPart).join("").trim()
  }

  return collectTextFromPart(content).trim()
}

function shouldLoadProviderEnv(options: InceptionOptions) {
  return (
    options.apiKey === undefined ||
    options.baseUrl === undefined ||
    options.maxTokens === undefined ||
    options.model === undefined ||
    options.reasoningEffort === undefined ||
    options.temperature === undefined
  )
}

function tryGetProviderEnv(options: InceptionOptions): ProviderEnv | undefined {
  if (!shouldLoadProviderEnv(options)) {
    return undefined
  }

  try {
    return getProviderEnv()
  } catch {
    if (options.apiKey === undefined) {
      throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
    }

    return undefined
  }
}

function resolveOptions(options: InceptionOptions): ResolvedOptions {
  const providerEnv = tryGetProviderEnv(options)
  const apiKey = options.apiKey ?? providerEnv?.inceptionApiKeys[0]

  if (!apiKey) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  return {
    apiKey,
    baseUrl: options.baseUrl ?? providerEnv?.inceptionBaseUrl ?? DEFAULT_BASE_URL,
    fetchImpl: options.fetchImpl ?? fetch,
    keyId: options.keyId ?? (options.apiKey === undefined ? "inception:1" : "inception:direct"),
    maxTokens: options.maxTokens ?? providerEnv?.inceptionMaxTokens ?? DEFAULT_MAX_TOKENS,
    model: options.model ?? providerEnv?.inceptionChatModel ?? DEFAULT_MODEL,
    reasoningEffort: options.reasoningEffort ?? providerEnv?.inceptionReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    temperature: options.temperature ?? providerEnv?.inceptionTemperature ?? DEFAULT_TEMPERATURE
  }
}

function chatCompletionsUrl(baseUrl: string) {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "")
  return trimmedBaseUrl.endsWith("/chat/completions") ? trimmedBaseUrl : `${trimmedBaseUrl}/chat/completions`
}

function errorSignalIncludesQuota(signal: string) {
  return /balance|credit|exhaust|insufficient|payment[_\s-]?required|quota/.test(signal)
}

function collectErrorSignals(value: unknown): string[] {
  if (typeof value === "string") {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectErrorSignals)
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => ["code", "error", "message", "type"].includes(key))
      .flatMap(([, nested]) => collectErrorSignals(nested))
  }

  return []
}

async function readErrorSignal(response: Response) {
  try {
    return collectErrorSignals(await response.json())
      .join(" ")
      .toLowerCase()
  } catch {
    return ""
  }
}

async function throwForHttpError(response: Response, keyId: string): Promise<never> {
  if (response.status === 429) {
    throw new ProviderRateLimitError({
      keyId,
      provider: INCEPTION_PROVIDER,
      retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After") ?? undefined, Date.now())
    })
  }

  if (response.status >= 500) {
    throw new ProviderTransientError({ keyId, provider: INCEPTION_PROVIDER })
  }

  if (response.status === 402) {
    throw new ProviderQuotaExhaustedError({ keyId, provider: INCEPTION_PROVIDER })
  }

  const errorSignal = await readErrorSignal(response)
  if (errorSignalIncludesQuota(errorSignal)) {
    throw new ProviderQuotaExhaustedError({ keyId, provider: INCEPTION_PROVIDER })
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderPermanentError({ keyId, provider: INCEPTION_PROVIDER })
  }

  throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
}

function requiredTrimmedString(value: unknown) {
  if (typeof value !== "string") {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  return trimmed
}

function parseGroundedAnswer(content: unknown): GroundedAnswer {
  const jsonText = extractTextContent(content)
  if (!jsonText) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const answerSummary = requiredTrimmedString((parsed as { answerSummary?: unknown }).answerSummary)
  const answerSteps = (parsed as { answerSteps?: unknown }).answerSteps
  const citationIds = (parsed as { citationIds?: unknown }).citationIds
  if (
    !Array.isArray(answerSteps) ||
    !answerSteps.every((step): step is string => typeof step === "string") ||
    !Array.isArray(citationIds) ||
    !citationIds.every((citationId): citationId is string => typeof citationId === "string")
  ) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  return {
    answerSteps,
    answerSummary,
    citationIds
  }
}

function parseInsufficientEvidenceSummary(content: unknown) {
  const jsonText = extractTextContent(content)
  if (!jsonText) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const answerSummary = requiredTrimmedString((parsed as { answerSummary?: unknown }).answerSummary)

  return { answerSummary }
}

function parseClarifyingQuestion(content: unknown) {
  const jsonText = extractTextContent(content)
  if (!jsonText) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const clarifyingQuestion = requiredTrimmedString((parsed as { clarifyingQuestion?: unknown }).clarifyingQuestion)

  return { clarifyingQuestion }
}

function tokenCount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }

  return Math.floor(value)
}

function parseProviderUsage(usage: unknown): ProviderTokenUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined
  }

  const usageRecord = usage as Record<string, unknown>
  const inputTokens = tokenCount(usageRecord.prompt_tokens ?? usageRecord.input_tokens)
  const outputTokens = tokenCount(usageRecord.completion_tokens ?? usageRecord.output_tokens)
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined
  }

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens })
  }
}

async function requestStructuredCompletion({
  messages,
  options,
  schema,
  schemaName
}: StructuredCompletionRequest): Promise<StructuredCompletion> {
  const resolvedOptions = resolveOptions(options)
  let response: Response
  try {
    response = await resolvedOptions.fetchImpl(chatCompletionsUrl(resolvedOptions.baseUrl), {
      body: JSON.stringify({
        max_tokens: resolvedOptions.maxTokens,
        messages,
        model: resolvedOptions.model,
        reasoning_effort: resolvedOptions.reasoningEffort,
        reasoning_summary: false,
        response_format: {
          json_schema: {
            name: schemaName,
            schema,
            strict: true
          },
          type: "json_schema"
        },
        stream: false,
        temperature: resolvedOptions.temperature
      }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${resolvedOptions.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    })
  } catch {
    throw new ProviderTransientError({ keyId: resolvedOptions.keyId, provider: INCEPTION_PROVIDER })
  }

  if (!response.ok) {
    await throwForHttpError(response, resolvedOptions.keyId)
  }

  let payload: { choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>; usage?: unknown }
  try {
    payload = (await response.json()) as {
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>
      usage?: unknown
    }
  } catch {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const choice = payload.choices?.[0]
  if (choice?.finish_reason === "length") {
    throw new ProviderTransientError({ keyId: resolvedOptions.keyId, provider: INCEPTION_PROVIDER })
  }

  const usage = parseProviderUsage(payload.usage)
  return usage === undefined ? { content: choice?.message?.content } : { content: choice?.message?.content, usage }
}

export async function generateGroundedAnswer(
  question: string,
  context: string,
  language: ResponseLanguagePolicy,
  options: InceptionOptions = {}
) {
  const completion = await requestStructuredCompletion({
    messages: [
      {
        content: `Use only the provided context. ${language.instruction} preserve technical identifiers, code, commands, and citation labels when translating them could change meaning. If the context is insufficient, return an empty answerSteps array and an empty citationIds array. Return strict JSON with keys answerSummary, answerSteps, and citationIds.`,
        role: "system"
      },
      {
        content: `Question: ${question}\n\nContext: ${context}`,
        role: "user"
      }
    ],
    options,
    schema: GROUNDED_ANSWER_SCHEMA,
    schemaName: "GroundedAnswer"
  })

  const groundedAnswer = parseGroundedAnswer(completion.content)
  return completion.usage === undefined ? groundedAnswer : { ...groundedAnswer, usage: completion.usage }
}

export async function generateInsufficientEvidenceSummary(
  question: string,
  language: ResponseLanguagePolicy,
  options: InceptionOptions = {}
): Promise<{ answerSummary: string; usage?: ProviderTokenUsage }> {
  const completion = await requestStructuredCompletion({
    messages: [
      {
        content: `Official documentation evidence is insufficient to answer the user's question. ${language.instruction} Do not invent evidence, citations, steps, product details, or assumptions. Return strict JSON with key answerSummary.`,
        role: "system"
      },
      {
        content: `Question: ${question}`,
        role: "user"
      }
    ],
    options,
    schema: INSUFFICIENT_EVIDENCE_SCHEMA,
    schemaName: "InsufficientEvidenceSummary"
  })

  const summary = parseInsufficientEvidenceSummary(completion.content)
  return completion.usage === undefined ? summary : { ...summary, usage: completion.usage }
}

export async function generateClarifyingQuestion(
  input: { interpretedProblem: string; missingContext: string[] },
  language: ResponseLanguagePolicy,
  options: InceptionOptions = {}
): Promise<{ clarifyingQuestion: string; usage?: ProviderTokenUsage }> {
  const completion = await requestStructuredCompletion({
    messages: [
      {
        content: `Ask one concise clarification question using only the missing context. ${language.instruction} Do not add product details not provided. Do not ask for anything beyond the missing context. Return strict JSON with key clarifyingQuestion.`,
        role: "system"
      },
      {
        content: `Interpreted problem: ${input.interpretedProblem}\n\nMissing context: ${input.missingContext.join(", ")}`,
        role: "user"
      }
    ],
    options,
    schema: CLARIFYING_QUESTION_SCHEMA,
    schemaName: "ClarifyingQuestion"
  })

  const clarification = parseClarifyingQuestion(completion.content)
  return completion.usage === undefined ? clarification : { ...clarification, usage: completion.usage }
}
