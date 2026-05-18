import { describe, expect, it, vi } from "vitest"

import { extractTextContent, generateGroundedAnswer } from "./inception"
import {
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./providerErrors"

type FetchMock = ReturnType<typeof vi.fn>

type CapturedRequest = {
  body: Record<string, unknown>
  headers: Record<string, string>
  url: string
}

function createChatResponse(content: unknown, init?: ResponseInit) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content
          }
        }
      ]
    }),
    init
  )
}

function getRequest(fetchImpl: FetchMock): CapturedRequest {
  const call = fetchImpl.mock.calls[0]
  if (!call) {
    throw new Error("Expected fetch to be called")
  }

  const [url, init] = call as [string, RequestInit]
  return {
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
    url
  }
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error("Expected promise to reject")
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

async function withProviderEnv<T>(fn: () => Promise<T>) {
  const previousEnv = {
    inceptionApiKeys: process.env.INCEPTION_API_KEYS,
    inceptionBaseUrl: process.env.INCEPTION_BASE_URL,
    inceptionChatModel: process.env.INCEPTION_CHAT_MODEL,
    inceptionMaxTokens: process.env.INCEPTION_MAX_TOKENS,
    inceptionReasoningEffort: process.env.INCEPTION_REASONING_EFFORT,
    inceptionTemperature: process.env.INCEPTION_TEMPERATURE,
    jinaApiKeys: process.env.JINA_API_KEYS,
    mineruApiToken: process.env.MINERU_API_TOKEN
  }

  process.env.INCEPTION_API_KEYS = "env-inception-key-1,env-inception-key-2"
  delete process.env.INCEPTION_BASE_URL
  delete process.env.INCEPTION_CHAT_MODEL
  delete process.env.INCEPTION_MAX_TOKENS
  delete process.env.INCEPTION_REASONING_EFFORT
  delete process.env.INCEPTION_TEMPERATURE
  process.env.JINA_API_KEYS = "jina-key"
  process.env.MINERU_API_TOKEN = "mineru-token"

  try {
    return await fn()
  } finally {
    restoreEnv("INCEPTION_API_KEYS", previousEnv.inceptionApiKeys)
    restoreEnv("INCEPTION_BASE_URL", previousEnv.inceptionBaseUrl)
    restoreEnv("INCEPTION_CHAT_MODEL", previousEnv.inceptionChatModel)
    restoreEnv("INCEPTION_MAX_TOKENS", previousEnv.inceptionMaxTokens)
    restoreEnv("INCEPTION_REASONING_EFFORT", previousEnv.inceptionReasoningEffort)
    restoreEnv("INCEPTION_TEMPERATURE", previousEnv.inceptionTemperature)
    restoreEnv("JINA_API_KEYS", previousEnv.jinaApiKeys)
    restoreEnv("MINERU_API_TOKEN", previousEnv.mineruApiToken)
  }
}

async function withCustomInceptionEnv<T>(fn: () => Promise<T>) {
  const previousEnv = {
    inceptionApiKeys: process.env.INCEPTION_API_KEYS,
    inceptionBaseUrl: process.env.INCEPTION_BASE_URL,
    inceptionChatModel: process.env.INCEPTION_CHAT_MODEL,
    inceptionMaxTokens: process.env.INCEPTION_MAX_TOKENS,
    inceptionReasoningEffort: process.env.INCEPTION_REASONING_EFFORT,
    inceptionTemperature: process.env.INCEPTION_TEMPERATURE,
    jinaApiKeys: process.env.JINA_API_KEYS,
    mineruApiToken: process.env.MINERU_API_TOKEN
  }

  process.env.INCEPTION_API_KEYS = "env-inception-key"
  process.env.INCEPTION_BASE_URL = "https://env.example/v1"
  process.env.INCEPTION_CHAT_MODEL = "env-mercury-model"
  process.env.INCEPTION_MAX_TOKENS = "2048"
  process.env.INCEPTION_REASONING_EFFORT = "high"
  process.env.INCEPTION_TEMPERATURE = "0.9"
  process.env.JINA_API_KEYS = "jina-key"
  process.env.MINERU_API_TOKEN = "mineru-token"

  try {
    return await fn()
  } finally {
    restoreEnv("INCEPTION_API_KEYS", previousEnv.inceptionApiKeys)
    restoreEnv("INCEPTION_BASE_URL", previousEnv.inceptionBaseUrl)
    restoreEnv("INCEPTION_CHAT_MODEL", previousEnv.inceptionChatModel)
    restoreEnv("INCEPTION_MAX_TOKENS", previousEnv.inceptionMaxTokens)
    restoreEnv("INCEPTION_REASONING_EFFORT", previousEnv.inceptionReasoningEffort)
    restoreEnv("INCEPTION_TEMPERATURE", previousEnv.inceptionTemperature)
    restoreEnv("JINA_API_KEYS", previousEnv.jinaApiKeys)
    restoreEnv("MINERU_API_TOKEN", previousEnv.mineruApiToken)
  }
}

function expectNoSecretLeak(error: unknown) {
  expect((error as Error).message).not.toContain("sk-secret")
  expect((error as Error).message).not.toContain("secret question")
  expect((error as Error).message).not.toContain("secret context")
}

describe("extractTextContent", () => {
  it("trims strings and joins structured text parts", () => {
    expect(extractTextContent("  text  ")).toBe("text")
    expect(extractTextContent([{ text: "first" }, { content: " second" }, { value: " third" }, { ignored: "no" }])).toBe(
      "first second third"
    )
  })

  it("extracts string fields from top-level structured objects", () => {
    expect(extractTextContent({ text: " text field " })).toBe("text field")
    expect(extractTextContent({ content: " content field " })).toBe("content field")
    expect(extractTextContent({ value: " value field " })).toBe("value field")
  })

  it("returns an empty string for unknown content", () => {
    expect(extractTextContent(undefined)).toBe("")
    expect(extractTextContent({ nested: { text: "ignored" } })).toBe("")
  })
})

describe("generateGroundedAnswer", () => {
  it("posts the default structured-output request and parses JSON string content", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponse('{"answerSummary":"Use the safety relay.","answerSteps":["Wire channel A"],"citationIds":["E1"]}')
    )

    await expect(
      withProviderEnv(() =>
        generateGroundedAnswer(
          "How should I wire it?",
          "Use the safety relay. [E1]",
          { code: "en", instruction: "Answer in English." },
          { fetchImpl }
        )
      )
    ).resolves.toEqual({
      answerSteps: ["Wire channel A"],
      answerSummary: "Use the safety relay.",
      citationIds: ["E1"]
    })

    const request = getRequest(fetchImpl)
    expect(request.url).toBe("https://api.inceptionlabs.ai/v1/chat/completions")
    expect(request.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer env-inception-key-1",
      "Content-Type": "application/json"
    })
    expect(request.body).toMatchObject({
      max_tokens: 8192,
      model: "mercury-2",
      reasoning_effort: "medium",
      reasoning_summary: false,
      stream: false,
      temperature: 0.75
    })
    expect(request.body.response_format).toEqual({
      json_schema: {
        name: "GroundedAnswer",
        schema: {
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
        },
        strict: true
      },
      type: "json_schema"
    })
    expect(request.body.messages).toEqual([
      {
        content: expect.stringContaining("Answer in English."),
        role: "system"
      },
      {
        content: "Question: How should I wire it?\n\nContext: Use the safety relay. [E1]",
        role: "user"
      }
    ])
    expect(String((request.body.messages as Array<{ content: string }>)[0]?.content)).toContain("Use only the provided context")
    expect(String((request.body.messages as Array<{ content: string }>)[0]?.content)).toContain("preserve technical identifiers")
  })

  it("includes all grounded-answer constraints in the system prompt", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponse('{"answerSummary":"Summary","answerSteps":["Step"],"citationIds":["E1"]}')
    )

    await generateGroundedAnswer(
      "Question",
      "Context",
      { code: "en", instruction: "Answer in English." },
      {
        apiKey: "key",
        fetchImpl
      }
    )

    const request = getRequest(fetchImpl)
    const systemPrompt = String((request.body.messages as Array<{ content: string }>)[0]?.content)
    expect(systemPrompt).toContain("preserve technical identifiers")
    expect(systemPrompt).toContain("code")
    expect(systemPrompt).toContain("commands")
    expect(systemPrompt).toContain("citation labels")
    expect(systemPrompt).toContain("If the context is insufficient")
    expect(systemPrompt).toContain("empty answerSteps array")
    expect(systemPrompt).toContain("empty citationIds array")
  })

  it("uses option overrides for request configuration", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponse('{"answerSummary":"Summary","answerSteps":["Step"],"citationIds":["E1"]}')
    )

    await generateGroundedAnswer(
      "Question",
      "Context",
      { code: "en", instruction: "Answer in English." },
      {
        apiKey: "override-key",
        baseUrl: "https://custom.example/v1",
        fetchImpl,
        maxTokens: 256,
        model: "custom-mercury",
        reasoningEffort: "high",
        temperature: 0.6
      }
    )

    const request = getRequest(fetchImpl)
    expect(request.url).toBe("https://custom.example/v1/chat/completions")
    expect(request.headers.Authorization).toBe("Bearer override-key")
    expect(request.body).toMatchObject({
      max_tokens: 256,
      model: "custom-mercury",
      reasoning_effort: "high",
      temperature: 0.6
    })
  })

  it("uses Inception env fallback values when request options omit them", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponse('{"answerSummary":"Summary","answerSteps":["Step"],"citationIds":["E1"]}')
    )

    await withCustomInceptionEnv(() =>
      generateGroundedAnswer("Question", "Context", { code: "en", instruction: "Answer in English." }, { fetchImpl })
    )

    const request = getRequest(fetchImpl)
    expect(request.url).toBe("https://env.example/v1/chat/completions")
    expect(request.body).toMatchObject({
      max_tokens: 2048,
      model: "env-mercury-model",
      reasoning_effort: "high",
      temperature: 0.9
    })
  })

  it("joins structured content arrays before parsing JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponse([
        { text: '{"answerSummary":"Install beside the controller.","answerSteps":[' },
        { content: '"Check the rail"],"citationIds":' },
        { value: '["E2"]}' }
      ])
    )

    await expect(
      generateGroundedAnswer(
        "Where should it go?",
        "Install beside the controller. [E2]",
        {
          code: "en",
          instruction: "Answer in English."
        },
        { apiKey: "key", fetchImpl }
      )
    ).resolves.toEqual({
      answerSteps: ["Check the rail"],
      answerSummary: "Install beside the controller.",
      citationIds: ["E2"]
    })
  })

  it("throws ProviderRateLimitError for HTTP 429 using Retry-After", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "rate_limit" } }), {
          headers: { "Retry-After": "4" },
          status: 429
        })
    )

    const error = await captureError(
      generateGroundedAnswer(
        "question",
        "context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "key",
          fetchImpl,
          keyId: "inception:7"
        }
      )
    )

    expect(error).toBeInstanceOf(ProviderRateLimitError)
    expect(error).toMatchObject({ keyId: "inception:7", retryAfterMs: 4000 })
  })

  it("throws sanitized ProviderPermanentError for malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => createChatResponse("not JSON with sk-secret secret question secret context"))

    const error = await captureError(
      generateGroundedAnswer(
        "secret question",
        "secret context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "sk-secret",
          fetchImpl
        }
      )
    )

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expect(error).toMatchObject({ message: "inception provider request failed permanently" })
    expectNoSecretLeak(error)
  })

  it("throws sanitized ProviderPermanentError for wrong output field types", async () => {
    const fetchImpl = vi.fn(async () => createChatResponse('{"answerSummary":123,"answerSteps":["Step"],"citationIds":["E1"]}'))

    const error = await captureError(
      generateGroundedAnswer(
        "secret question",
        "secret context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "sk-secret",
          fetchImpl
        }
      )
    )

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expectNoSecretLeak(error)
  })

  it("throws ProviderQuotaExhaustedError for quota signals", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "insufficient_balance", message: "top up" } }), { status: 403 })
    )

    await expect(
      generateGroundedAnswer(
        "question",
        "context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "key",
          fetchImpl,
          keyId: "inception:3"
        }
      )
    ).rejects.toBeInstanceOf(ProviderQuotaExhaustedError)
  })

  it("throws ProviderQuotaExhaustedError for HTTP 402 quota signals", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "payment_required", message: "insufficient balance" } }), { status: 402 })
    )

    await expect(
      generateGroundedAnswer(
        "question",
        "context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "key",
          fetchImpl,
          keyId: "inception:4"
        }
      )
    ).rejects.toBeInstanceOf(ProviderQuotaExhaustedError)
  })

  it("throws ProviderTransientError for HTTP 5xx and network failures", async () => {
    const httpFetchImpl = vi.fn(
      async () => new Response("raw body with sk-secret secret question secret context", { status: 503 })
    )
    const httpError = await captureError(
      generateGroundedAnswer(
        "secret question",
        "secret context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "sk-secret",
          fetchImpl: httpFetchImpl,
          keyId: "inception:5"
        }
      )
    )

    expect(httpError).toBeInstanceOf(ProviderTransientError)
    expectNoSecretLeak(httpError)

    const networkFetchImpl = vi.fn(async () => {
      throw new Error("network failure with sk-secret secret question secret context")
    })
    const networkError = await captureError(
      generateGroundedAnswer(
        "secret question",
        "secret context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "sk-secret",
          fetchImpl: networkFetchImpl,
          keyId: "inception:6"
        }
      )
    )

    expect(networkError).toBeInstanceOf(ProviderTransientError)
    expectNoSecretLeak(networkError)
  })

  it("throws sanitized ProviderPermanentError for non-quota HTTP errors", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "bad_request", message: "sk-secret secret question secret context" } }), {
          status: 400
        })
    )

    const error = await captureError(
      generateGroundedAnswer(
        "secret question",
        "secret context",
        { code: "en", instruction: "Answer in English." },
        {
          apiKey: "sk-secret",
          fetchImpl
        }
      )
    )

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expectNoSecretLeak(error)
  })
})
