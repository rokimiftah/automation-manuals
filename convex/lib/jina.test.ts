import { describe, expect, it, vi } from "vitest"

import {
  embedDocumentTexts,
  embedSearchQuery,
  estimateJinaEmbeddingRequestCount,
  JINA_DOCUMENT_PREFIX,
  JINA_DOCUMENT_TASK,
  JINA_EMBEDDING_DIMENSIONS,
  JINA_EMBEDDING_PROVIDER,
  JINA_QUERY_PREFIX,
  JINA_QUERY_TASK
} from "./jina"
import {
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./providerErrors"

type FetchMock = ReturnType<typeof vi.fn>

function createEmbedding(value = 0.1) {
  return Array.from({ length: JINA_EMBEDDING_DIMENSIONS }, () => value)
}

function createJinaResponse(data: Array<{ embedding: number[]; index?: number }>, init?: ResponseInit) {
  return new Response(JSON.stringify({ data }), init)
}

function createUnreadableJsonResponse(errorMessage: string) {
  return {
    json: async () => {
      throw new Error(errorMessage)
    },
    ok: true
  } as unknown as Response
}

function getRequest(fetchImpl: FetchMock, callIndex = 0) {
  const call = fetchImpl.mock.calls[callIndex]
  if (!call) {
    throw new Error(`Expected fetch call ${callIndex + 1}`)
  }

  const [url, init] = call as [string, RequestInit]
  const body = JSON.parse(String(init.body)) as Record<string, unknown>
  return {
    body,
    headers: init.headers as Record<string, string>,
    url
  }
}

function createEchoFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: string[] }

    return createJinaResponse(
      body.input.map((_input, index) => ({
        embedding: createEmbedding(index + 1),
        index
      }))
    )
  })
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error("Expected promise to reject")
}

function expectSanitizedPermanentError(error: unknown) {
  expect(error).toBeInstanceOf(ProviderPermanentError)
  expect(error).toMatchObject({ message: "jina provider request failed permanently" })
  expect((error as Error).message).not.toContain("secret chunk")
  expect((error as Error).message).not.toContain("secret question")
  expect((error as Error).message).not.toContain("sk-test")
}

describe("Jina embedding constants", () => {
  it("exports provider and request prefix constants", () => {
    expect(JINA_EMBEDDING_PROVIDER).toBe("jina")
    expect(JINA_DOCUMENT_PREFIX).toBe("Document: ")
    expect(JINA_QUERY_PREFIX).toBe("Query: ")
  })
})

describe("estimateJinaEmbeddingRequestCount", () => {
  it("matches item-count batching", () => {
    const inputs = Array.from({ length: 51 }, (_, index) => `chunk ${index}`)

    expect(estimateJinaEmbeddingRequestCount(inputs, JINA_DOCUMENT_PREFIX)).toBe(2)
  })

  it("matches estimated-token batching", () => {
    const inputs = ["a".repeat(80), "b".repeat(80), "c".repeat(80)]

    expect(
      estimateJinaEmbeddingRequestCount(inputs, JINA_DOCUMENT_PREFIX, {
        maxEstimatedTokensPerBatch: 50,
        maxItemsPerBatch: 50
      })
    ).toBe(2)
  })
})

describe("embedDocumentTexts", () => {
  it("sends the Jina retrieval passage task", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    await embedDocumentTexts(["chunk"], { apiKey: "key", fetchImpl })

    expect(getRequest(fetchImpl).body.task).toBe(JINA_DOCUMENT_TASK)
  })

  it("prefixes document inputs only in the request body", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    await embedDocumentTexts(["chunk"], { apiKey: "key", fetchImpl })

    expect(getRequest(fetchImpl).body.input).toEqual(["Document: chunk"])
  })

  it("sends the required headers", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    await embedDocumentTexts(["chunk"], { apiKey: "key", fetchImpl })

    expect(getRequest(fetchImpl).headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer key",
      "Content-Type": "application/json"
    })
  })

  it("sends the required embedding request options", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    await embedDocumentTexts(["chunk"], { apiKey: "key", fetchImpl, model: "jina-test-model" })
    expect(getRequest(fetchImpl).url).toBe("https://api.jina.ai/v1/embeddings")
    expect(getRequest(fetchImpl).body).toMatchObject({
      dimensions: 1024,
      embedding_type: "float",
      model: "jina-test-model",
      normalized: true,
      truncate: false
    })
  })

  it("returns an empty result without calling fetch for empty document input", async () => {
    const fetchImpl = vi.fn()

    await expect(embedDocumentTexts([], { apiKey: "key", fetchImpl })).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("splits batches by item count and estimated token ceiling", async () => {
    const itemFetchImpl = createEchoFetch()

    await embedDocumentTexts(["first", "second", "third"], {
      apiKey: "key",
      fetchImpl: itemFetchImpl,
      maxEstimatedTokensPerBatch: 1000,
      maxItemsPerBatch: 2
    })

    expect(itemFetchImpl).toHaveBeenCalledTimes(2)
    expect(getRequest(itemFetchImpl, 0).body.input).toEqual(["Document: first", "Document: second"])
    expect(getRequest(itemFetchImpl, 1).body.input).toEqual(["Document: third"])

    const tokenFetchImpl = createEchoFetch()
    await embedDocumentTexts(["12345678901234567890", "abcdefghijabcdefghij"], {
      apiKey: "key",
      fetchImpl: tokenFetchImpl,
      maxEstimatedTokensPerBatch: 8,
      maxItemsPerBatch: 50
    })

    expect(tokenFetchImpl).toHaveBeenCalledTimes(2)
    expect(getRequest(tokenFetchImpl, 0).body.input).toEqual(["Document: 12345678901234567890"])
    expect(getRequest(tokenFetchImpl, 1).body.input).toEqual(["Document: abcdefghijabcdefghij"])
  })

  it("orders returned embeddings by provider index when present", async () => {
    const first = createEmbedding(0.1)
    const second = createEmbedding(0.2)
    const fetchImpl = vi.fn(async () =>
      createJinaResponse([
        { embedding: second, index: 1 },
        { embedding: first, index: 0 }
      ])
    )

    await expect(embedDocumentTexts(["first", "second"], { apiKey: "key", fetchImpl })).resolves.toEqual([first, second])
  })

  it("throws a sanitized ProviderPermanentError when successful responses contain unreadable JSON", async () => {
    const fetchImpl = vi.fn(async () => createUnreadableJsonResponse("invalid JSON for sk-test and secret chunk"))

    const error = await captureError(embedDocumentTexts(["secret chunk"], { apiKey: "sk-test", fetchImpl }))

    expectSanitizedPermanentError(error)
    expect((error as Error).message).not.toContain("invalid JSON")
  })

  it("throws a sanitized ProviderPermanentError when fewer embeddings are returned than requested", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    const error = await captureError(embedDocumentTexts(["secret chunk", "second chunk"], { apiKey: "sk-test", fetchImpl }))

    expectSanitizedPermanentError(error)
  })

  it("throws a sanitized ProviderPermanentError when extra embeddings are returned", async () => {
    const fetchImpl = vi.fn(async () =>
      createJinaResponse([
        { embedding: createEmbedding(0.1), index: 0 },
        { embedding: createEmbedding(0.2), index: 1 }
      ])
    )

    const error = await captureError(embedDocumentTexts(["secret chunk"], { apiKey: "sk-test", fetchImpl }))

    expectSanitizedPermanentError(error)
  })

  it("throws a sanitized ProviderPermanentError for duplicate provider indexes", async () => {
    const fetchImpl = vi.fn(async () =>
      createJinaResponse([
        { embedding: createEmbedding(0.1), index: 0 },
        { embedding: createEmbedding(0.2), index: 0 }
      ])
    )

    const error = await captureError(embedDocumentTexts(["secret chunk", "second chunk"], { apiKey: "sk-test", fetchImpl }))

    expectSanitizedPermanentError(error)
  })

  it("throws a sanitized ProviderPermanentError for out-of-range provider indexes", async () => {
    const fetchImpl = vi.fn(async () =>
      createJinaResponse([
        { embedding: createEmbedding(0.1), index: 0 },
        { embedding: createEmbedding(0.2), index: 2 }
      ])
    )

    const error = await captureError(embedDocumentTexts(["secret chunk", "second chunk"], { apiKey: "sk-test", fetchImpl }))

    expectSanitizedPermanentError(error)
  })

  it("throws when a returned embedding has an unexpected dimension count", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: [0.1, 0.2], index: 0 }]))

    await expect(embedDocumentTexts(["chunk"], { apiKey: "key", fetchImpl })).rejects.toThrow(
      "Jina embedding response returned 2 dimensions; expected 1024"
    )
  })

  it("rejects non-finite embedding values with a sanitized provider error", async () => {
    const embedding = createEmbedding()
    embedding[10] = Number.NaN
    const fetchImpl = vi.fn(
      async () =>
        ({
          json: async () => ({ data: [{ embedding, index: 0 }] }),
          ok: true
        }) as Response
    )

    const error = await captureError(embedDocumentTexts(["secret chunk"], { apiKey: "sk-test", fetchImpl }))

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expect(error).toMatchObject({ message: "jina provider request failed permanently" })
    expect((error as Error).message).not.toContain("secret chunk")
    expect((error as Error).message).not.toContain("sk-test")
  })
})

describe("embedSearchQuery", () => {
  it("sends the Jina retrieval query task", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    await embedSearchQuery("question", { apiKey: "key", fetchImpl })

    expect(getRequest(fetchImpl).body.task).toBe(JINA_QUERY_TASK)
  })

  it("prefixes query inputs only in the request body", async () => {
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    await embedSearchQuery("question", { apiKey: "key", fetchImpl })
    expect(getRequest(fetchImpl).body.input).toEqual(["Query: question"])
  })

  it("returns the parsed query embedding", async () => {
    const embedding = createEmbedding(0.42)
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding, index: 0 }]))

    await expect(embedSearchQuery("question", { apiKey: "key", fetchImpl })).resolves.toEqual(embedding)
  })

  it("uses the first configured Jina key and env model when options omit them", async () => {
    const previousEnv = {
      inceptionApiKeys: process.env.INCEPTION_API_KEYS,
      jinaApiKeys: process.env.JINA_API_KEYS,
      jinaEmbedModel: process.env.JINA_EMBED_MODEL,
      mineruApiToken: process.env.MINERU_API_TOKEN
    }
    process.env.INCEPTION_API_KEYS = "inception-key"
    process.env.JINA_API_KEYS = "env-jina-key-1,env-jina-key-2"
    process.env.JINA_EMBED_MODEL = "env-jina-model"
    process.env.MINERU_API_TOKEN = "mineru-token"
    const fetchImpl = vi.fn(async () => createJinaResponse([{ embedding: createEmbedding(), index: 0 }]))

    try {
      await embedSearchQuery("question", { fetchImpl })
    } finally {
      process.env.INCEPTION_API_KEYS = previousEnv.inceptionApiKeys
      process.env.JINA_API_KEYS = previousEnv.jinaApiKeys
      process.env.JINA_EMBED_MODEL = previousEnv.jinaEmbedModel
      process.env.MINERU_API_TOKEN = previousEnv.mineruApiToken
    }

    expect(getRequest(fetchImpl).headers.Authorization).toBe("Bearer env-jina-key-1")
    expect(getRequest(fetchImpl).body.model).toBe("env-jina-model")
  })

  it("throws ProviderRateLimitError for HTTP 429 using Retry-After", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "rate_limit" } }), {
          headers: { "Retry-After": "3" },
          status: 429
        })
    )

    const error = await captureError(embedSearchQuery("question", { apiKey: "key", fetchImpl, keyId: "jina:7" }))

    expect(error).toBeInstanceOf(ProviderRateLimitError)
    expect(error).toMatchObject({ keyId: "jina:7", retryAfterMs: 3000 })
  })

  it("throws ProviderPermanentError for HTTP 401 without leaking provider details", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "key question" } }), { status: 401 })
    )

    const error = await captureError(embedSearchQuery("question", { apiKey: "key", fetchImpl, keyId: "jina:9" }))

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expect(error).toMatchObject({ keyId: "jina:9", provider: "jina" })
    expect((error as Error).message).not.toContain("invalid_api_key")
    expect((error as Error).message).not.toContain("question")
  })

  it("throws ProviderQuotaExhaustedError for HTTP 401 quota signals", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "insufficient_balance", message: "top up account" } }), { status: 401 })
    )

    await expect(embedSearchQuery("question", { apiKey: "key", fetchImpl, keyId: "jina:3" })).rejects.toBeInstanceOf(
      ProviderQuotaExhaustedError
    )
  })

  it("throws ProviderPermanentError for HTTP 400 without leaking request details", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "bad_request", message: "secret question sk-test" } }), { status: 400 })
    )

    const error = await captureError(embedSearchQuery("secret question", { apiKey: "sk-test", fetchImpl }))

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expect(error).toMatchObject({ message: "jina provider request failed permanently" })
    expect((error as Error).message).not.toContain("secret question")
    expect((error as Error).message).not.toContain("sk-test")
  })

  it("throws ProviderQuotaExhaustedError for HTTP 403 quota signals without leaking request details", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "quota_exhausted", message: "secret question sk-test" } }), { status: 403 })
    )

    const error = await captureError(embedSearchQuery("secret question", { apiKey: "sk-test", fetchImpl, keyId: "jina:4" }))

    expect(error).toBeInstanceOf(ProviderQuotaExhaustedError)
    expect((error as Error).message).not.toContain("secret question")
    expect((error as Error).message).not.toContain("sk-test")
  })

  it("throws ProviderTransientError for HTTP 5xx without input text or API keys", async () => {
    const fetchImpl = vi.fn(async () => new Response("raw body with sk-test and secret question", { status: 503 }))

    const error = await captureError(embedSearchQuery("secret question", { apiKey: "sk-test", fetchImpl, keyId: "jina:9" }))

    expect(error).toBeInstanceOf(ProviderTransientError)
    expect((error as Error).message).not.toContain("secret question")
    expect((error as Error).message).not.toContain("sk-test")
    expect((error as Error).message).not.toContain("raw body")
  })

  it("throws ProviderTransientError for network failures without input text or API keys", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network failure with sk-test and secret question")
    })

    const error = await captureError(embedSearchQuery("secret question", { apiKey: "sk-test", fetchImpl, keyId: "jina:5" }))

    expect(error).toBeInstanceOf(ProviderTransientError)
    expect((error as Error).message).not.toContain("secret question")
    expect((error as Error).message).not.toContain("sk-test")
    expect((error as Error).message).not.toContain("network failure")
  })
})
