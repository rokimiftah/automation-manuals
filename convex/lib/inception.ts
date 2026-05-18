import type { QuestionLanguage } from "./questionLanguage"

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

type ProviderTokenUsage = {
  inputTokens?: number
  outputTokens?: number
}

const INCEPTION_PROVIDER = "inception"
const DEFAULT_BASE_URL = "https://api.inceptionlabs.ai/v1"
const DEFAULT_MODEL = "mercury-2"
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_REASONING_EFFORT = "medium"
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
  return /balance|credit|exhaust|insufficient|quota/.test(signal)
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

  if (errorSignalIncludesQuota(await readErrorSignal(response))) {
    throw new ProviderQuotaExhaustedError({ keyId, provider: INCEPTION_PROVIDER })
  }

  throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
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

  const answerSummary = (parsed as { answerSummary?: unknown }).answerSummary
  const answerSteps = (parsed as { answerSteps?: unknown }).answerSteps
  const citationIds = (parsed as { citationIds?: unknown }).citationIds
  if (
    typeof answerSummary !== "string" ||
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

export async function generateGroundedAnswer(
  question: string,
  context: string,
  language: QuestionLanguage,
  options: InceptionOptions = {}
) {
  const resolvedOptions = resolveOptions(options)
  let response: Response
  try {
    response = await resolvedOptions.fetchImpl(chatCompletionsUrl(resolvedOptions.baseUrl), {
      body: JSON.stringify({
        max_tokens: resolvedOptions.maxTokens,
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
        model: resolvedOptions.model,
        reasoning_effort: resolvedOptions.reasoningEffort,
        reasoning_summary: false,
        response_format: {
          json_schema: {
            name: "GroundedAnswer",
            schema: GROUNDED_ANSWER_SCHEMA,
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

  let payload: { choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown }
  try {
    payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown }
  } catch {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const groundedAnswer = parseGroundedAnswer(payload.choices?.[0]?.message?.content)
  const usage = parseProviderUsage(payload.usage)
  return usage === undefined ? groundedAnswer : { ...groundedAnswer, usage }
}
