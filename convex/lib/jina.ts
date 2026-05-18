import { getProviderEnv } from "./env"
import {
  parseRetryAfterMs,
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./providerErrors"

export const JINA_EMBEDDING_DIMENSIONS = 1024
export const JINA_DOCUMENT_TASK = "retrieval.passage"
export const JINA_QUERY_TASK = "retrieval.query"
export const JINA_EMBEDDING_PROVIDER = "jina"
export const JINA_DOCUMENT_PREFIX = "Document: "
export const JINA_QUERY_PREFIX = "Query: "

const JINA_EMBEDDING_ENDPOINT = "https://api.jina.ai/v1/embeddings"
const JINA_DEFAULT_MODEL = "jina-embeddings-v5-text-small"
const DEFAULT_MAX_ITEMS_PER_BATCH = 50
const DEFAULT_MAX_ESTIMATED_TOKENS_PER_BATCH = 30_000

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>

type JinaEmbedOptions = {
  apiKey?: string
  fetchImpl?: FetchImpl
  keyId?: string
  maxEstimatedTokensPerBatch?: number
  maxItemsPerBatch?: number
  model?: string
}

type JinaBatchOptions = Pick<JinaEmbedOptions, "maxEstimatedTokensPerBatch" | "maxItemsPerBatch">

type JinaResponseItem = {
  embedding?: unknown
  index?: unknown
}

type JinaEmbeddingResponse = {
  data?: unknown
}

type ResolvedOptions = {
  apiKey: string
  fetchImpl: FetchImpl
  keyId: string
  model: string
}

function positiveInteger(value: number | undefined, fallback: number) {
  const parsed = Math.floor(value ?? fallback)
  return parsed > 0 ? parsed : fallback
}

function estimateTokens(input: string) {
  return Math.max(1, Math.ceil(input.length / 4))
}

function resolveOptions(options: JinaEmbedOptions): ResolvedOptions {
  const providerEnv = options.apiKey === undefined ? getProviderEnv() : undefined
  const apiKey = options.apiKey ?? providerEnv?.jinaApiKeys[0]

  if (!apiKey) {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  return {
    apiKey,
    fetchImpl: options.fetchImpl ?? fetch,
    keyId: options.keyId ?? (providerEnv ? "jina:1" : "jina:direct"),
    model: options.model ?? providerEnv?.jinaEmbedModel ?? JINA_DEFAULT_MODEL
  }
}

function createBatches(inputs: string[], prefix: string, options: JinaEmbedOptions) {
  const maxItemsPerBatch = positiveInteger(options.maxItemsPerBatch, DEFAULT_MAX_ITEMS_PER_BATCH)
  const maxEstimatedTokensPerBatch = positiveInteger(options.maxEstimatedTokensPerBatch, DEFAULT_MAX_ESTIMATED_TOKENS_PER_BATCH)
  const batches: string[][] = []
  let batch: string[] = []
  let estimatedTokens = 0

  for (const input of inputs) {
    const prefixedInput = `${prefix}${input}`
    const inputTokens = estimateTokens(prefixedInput)
    if (batch.length > 0 && (batch.length >= maxItemsPerBatch || estimatedTokens + inputTokens > maxEstimatedTokensPerBatch)) {
      batches.push(batch)
      batch = []
      estimatedTokens = 0
    }

    batch.push(prefixedInput)
    estimatedTokens += inputTokens
  }

  if (batch.length > 0) {
    batches.push(batch)
  }

  return batches
}

export function estimateJinaEmbeddingRequestCount(inputs: string[], prefix: string, options: JinaBatchOptions = {}) {
  return createBatches(inputs, prefix, options).length
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
      provider: JINA_EMBEDDING_PROVIDER,
      retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After") ?? undefined, Date.now())
    })
  }

  if (response.status >= 500) {
    throw new ProviderTransientError({ keyId, provider: JINA_EMBEDDING_PROVIDER })
  }

  if ([400, 401, 403].includes(response.status) && errorSignalIncludesQuota(await readErrorSignal(response))) {
    throw new ProviderQuotaExhaustedError({ keyId, provider: JINA_EMBEDDING_PROVIDER })
  }

  throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
}

function orderResponseData(data: JinaResponseItem[], expectedCount: number) {
  if (!data.some((item) => item.index !== undefined)) {
    return data
  }

  const indexes = new Set<number>()
  for (const item of data) {
    if (typeof item.index !== "number" || !Number.isInteger(item.index) || item.index < 0 || item.index >= expectedCount) {
      throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
    }

    if (indexes.has(item.index)) {
      throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
    }

    indexes.add(item.index)
  }

  return [...data].sort((left, right) => {
    return (left.index as number) - (right.index as number)
  })
}

function validateEmbedding(embedding: unknown): number[] {
  if (!Array.isArray(embedding)) {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  if (embedding.length !== JINA_EMBEDDING_DIMENSIONS) {
    throw new Error(`Jina embedding response returned ${embedding.length} dimensions; expected ${JINA_EMBEDDING_DIMENSIONS}`)
  }

  if (!embedding.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  return embedding
}

function parseEmbeddingResponse(payload: JinaEmbeddingResponse, expectedCount: number) {
  if (!Array.isArray(payload.data)) {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  if (payload.data.length !== expectedCount) {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  return orderResponseData(payload.data as JinaResponseItem[], expectedCount).map((item) => validateEmbedding(item.embedding))
}

async function requestEmbeddingBatch(inputs: string[], task: string, options: ResolvedOptions) {
  let response: Response
  try {
    response = await options.fetchImpl(JINA_EMBEDDING_ENDPOINT, {
      body: JSON.stringify({
        dimensions: JINA_EMBEDDING_DIMENSIONS,
        embedding_type: "float",
        input: inputs,
        model: options.model,
        normalized: true,
        task,
        truncate: false
      }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    })
  } catch {
    throw new ProviderTransientError({ keyId: options.keyId, provider: JINA_EMBEDDING_PROVIDER })
  }

  if (!response.ok) {
    await throwForHttpError(response, options.keyId)
  }

  let payload: JinaEmbeddingResponse
  try {
    payload = (await response.json()) as JinaEmbeddingResponse
  } catch {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  return parseEmbeddingResponse(payload, inputs.length)
}

async function embedTextsWithTask(inputs: string[], task: string, prefix: string, options: JinaEmbedOptions) {
  if (inputs.length === 0) {
    return []
  }

  const resolvedOptions = resolveOptions(options)
  const embeddings: number[][] = []
  for (const batch of createBatches(inputs, prefix, options)) {
    embeddings.push(...(await requestEmbeddingBatch(batch, task, resolvedOptions)))
  }

  return embeddings
}

export async function embedDocumentTexts(inputs: string[], options: JinaEmbedOptions = {}) {
  return embedTextsWithTask(inputs, JINA_DOCUMENT_TASK, JINA_DOCUMENT_PREFIX, options)
}

export async function embedSearchQuery(question: string, options: JinaEmbedOptions = {}) {
  const embeddings = await embedTextsWithTask([question], JINA_QUERY_TASK, JINA_QUERY_PREFIX, options)
  const [embedding] = embeddings
  if (!embedding) {
    throw new ProviderPermanentError({ provider: JINA_EMBEDDING_PROVIDER })
  }

  return embedding
}
