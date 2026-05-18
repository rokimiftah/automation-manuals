import { getFunctionName } from "convex/server"
import { ConvexError } from "convex/values"

import { beforeEach, describe, expect, it, vi } from "vitest"

const buildProviderKeyPool = vi.fn((provider: "jina" | "inception", rawKeys: string[]) => {
  return rawKeys.map((secret, index) => ({ id: `${provider}:${index + 1}`, secret: secret.trim() }))
})
const embedSearchQuery = vi.fn()
const generateGroundedAnswer = vi.fn()
const getProviderEnv = vi.fn()
const resolveProviderKey = vi.fn((pool: Array<{ id: string; secret: string }>, keyId: string) => {
  const key = pool.find((item) => item.id === keyId)
  if (!key) {
    throw new Error(`Provider key ${keyId} is not configured`)
  }

  return key.secret
})

vi.mock("./lib/env", () => ({ getProviderEnv }))

vi.mock("./lib/providerKeys", () => ({ buildProviderKeyPool, resolveProviderKey }))

vi.mock("./lib/jina", () => ({
  embedSearchQuery,
  JINA_EMBEDDING_PROVIDER: "jina"
}))

vi.mock("./lib/inception", () => ({ generateGroundedAnswer }))

const { ask } = await import("./search")

const askHandler = ask as typeof ask & {
  _handler: (
    ctx: unknown,
    args: {
      documentId?: never
      question: string
      sessionAccessToken?: string
      sessionId: never
    }
  ) => Promise<{
    answerSteps: string[]
    answerSummary: string
    answerabilityStatus: "grounded" | "insufficient_evidence"
    citations: Array<{ chunkId: never; pageNumber: number; citationLabel: string; assetId?: never }>
    sessionAccessToken: string
    sessionId: never
    supportingAssets: Array<{ assetId: never; label: string; pageNumber: number }>
  }>
}

function exactPage<T>(page: T[], overrides?: Partial<{ continueCursor: string; isDone: boolean }>) {
  return {
    continueCursor: overrides?.continueCursor ?? "",
    isDone: overrides?.isDone ?? true,
    page
  }
}

const defaultProviderEnv = {
  inceptionApiKeys: ["mercury-test-key-1", "mercury-test-key-2"],
  inceptionBaseUrl: "https://api.inception.test/v1",
  inceptionChatModel: "mercury-test-model",
  inceptionInputTpmPerKey: 90_000,
  inceptionMaxConcurrentPerKey: 1,
  inceptionMaxTokens: 8192,
  inceptionOutputTpmPerKey: 9_000,
  inceptionReasoningEffort: "low" as const,
  inceptionRpmPerKey: 90,
  inceptionTemperature: 0.6,
  jinaApiKeys: ["jina-test-key-1", "jina-test-key-2"],
  jinaEmbedModel: "jina-test-model",
  jinaMaxConcurrentPerKey: 2,
  jinaRpmPerKey: 90,
  jinaTpmPerKey: 90_000,
  mineruApiToken: "mineru-test-token",
  mineruDailyFileLimit: 5000,
  mineruDailyPriorityPages: 1000,
  mineruResultQueryRatePerMinute: 1000,
  mineruSubmitRatePerMinute: 50
}

type ProviderReservation = { available: false; retryAfterMs: number } | { available: true; keyId: string }

function createRunMutation(
  appResults: unknown[],
  options: {
    inceptionReservation?: ProviderReservation
    jinaReservation?: ProviderReservation
    throwOnProviderSuccessFor?: "inception" | "jina"
  } = {}
) {
  const appResultQueue = [...appResults]

  return vi.fn(async (reference: unknown, args: Record<string, unknown>) => {
    const functionName = getFunctionName(reference as never)

    if (functionName === "providerRateLimits:reserveProviderKey") {
      return args.provider === "inception"
        ? (options.inceptionReservation ?? { available: true, keyId: "inception:1" })
        : (options.jinaReservation ?? { available: true, keyId: "jina:1" })
    }

    if (
      functionName === "providerRateLimits:disableProviderKey" ||
      functionName === "providerRateLimits:recordProviderRateLimit" ||
      functionName === "providerRateLimits:recordProviderSuccess" ||
      functionName === "providerRateLimits:recordProviderTransientFailure"
    ) {
      if (functionName === "providerRateLimits:recordProviderSuccess" && args.provider === options.throwOnProviderSuccessFor) {
        throw new Error("provider accounting write failed")
      }

      return null
    }

    return appResultQueue.shift()
  })
}

function getErrorMessage(error: unknown) {
  if (error instanceof ConvexError) {
    return String(error.data)
  }

  return error instanceof Error ? error.message : String(error)
}

function getMutationArgs(runMutation: ReturnType<typeof createRunMutation>, functionName: string) {
  return runMutation.mock.calls
    .filter(([reference]) => getFunctionName(reference as never) === functionName)
    .map(([, args]) => args as Record<string, unknown>)
}

describe("ask", () => {
  beforeEach(() => {
    buildProviderKeyPool.mockClear()
    embedSearchQuery.mockReset()
    generateGroundedAnswer.mockReset()
    getProviderEnv.mockReset()
    resolveProviderKey.mockClear()

    getProviderEnv.mockReturnValue(defaultProviderEnv)
    embedSearchQuery.mockResolvedValue([0.1, 0.2])
    generateGroundedAnswer.mockResolvedValue({
      answerSteps: ["Check the chassis."],
      answerSummary: "Install the module beside the controller.",
      citationIds: ["E1"]
    })
  })

  it("creates a new session and returns the session access token", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(exactPage([]))
    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2"
    ])
    const vectorSearch = vi.fn().mockResolvedValue([])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Where should the module go?",
        sessionId: undefined as never
      }
    )

    expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      title: "Where should the module go?"
    })
    expect(packet.sessionId).toBe("chatSessions_1")
    expect(packet.sessionAccessToken).toBe("access-token-1")
  })

  it("fails closed before provider calls when the public search rate limit is exceeded", async () => {
    const runQuery = vi.fn()
    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: false, retryAfterMs: 15_000 }
    ])
    const vectorSearch = vi.fn().mockResolvedValue([])

    await expect(
      askHandler._handler(
        {
          runMutation,
          runQuery,
          vectorSearch
        } as never,
        {
          question: "Where should the module go?",
          sessionId: undefined as never
        }
      )
    ).rejects.toThrow(/too many search requests/i)

    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(getMutationArgs(runMutation, "providerRateLimits:reserveProviderKey")).toEqual([])
    expect(vectorSearch).not.toHaveBeenCalled()
  })

  it("runs exact fallback for weak vector evidence without losing grounding", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Where should the module go?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "Install the module beside the controller.",
          pageNumber: 12,
          score: 0.4
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation(
      [{ allowed: true }, "chatMessages_1", "chatMessages_2", null, { sessionAccessToken: "access-token-2" }],
      {
        inceptionReservation: { available: true, keyId: "inception:2" },
        jinaReservation: { available: true, keyId: "jina:2" }
      }
    )

    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.4 }])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Where should the module go?",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledTimes(4)
    expect(vectorSearch).toHaveBeenCalledWith(
      "chunkEmbeddings",
      "by_embedding",
      expect.objectContaining({
        limit: 6,
        vector: [0.1, 0.2]
      })
    )
    expect(embedSearchQuery).toHaveBeenCalledWith("Where should the module go?", {
      apiKey: "jina-test-key-2",
      keyId: "jina:2",
      model: "jina-test-model"
    })
    const vectorOptions = vectorSearch.mock.calls[0]?.[2] as {
      filter: (builder: { eq: (field: string, value: boolean) => void }) => void
    }
    const eq = vi.fn()
    vectorOptions.filter({ eq })
    expect(eq).toHaveBeenCalledWith("isCurrent", true)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(generateGroundedAnswer).toHaveBeenCalledWith(
      "Where should the module go?",
      expect.any(String),
      expect.objectContaining({ code: "en" }),
      {
        apiKey: "mercury-test-key-2",
        baseUrl: "https://api.inception.test/v1",
        keyId: "inception:2",
        maxTokens: 8192,
        model: "mercury-test-model",
        reasoningEffort: "low",
        temperature: 0.6
      }
    )
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toHaveLength(2)
    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.answerSummary).toBe("Install the module beside the controller.")
  })

  it("returns a temporary capacity error without saving an assistant message when all Mercury keys are cooling down", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Where should the module go?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "Install the module beside the controller.",
          pageNumber: 12,
          score: 0.97
        }
      ])
    const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1"], {
      inceptionReservation: { available: false, retryAfterMs: 30_000 }
    })
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.97 }])

    await expect(
      askHandler._handler(
        {
          runMutation,
          runQuery,
          vectorSearch
        } as never,
        {
          question: "Where should the module go?",
          sessionAccessToken: "access-token-1",
          sessionId: "chatSessions_1" as never
        }
      )
    ).rejects.toThrow(/capacity|temporarily unavailable/i)

    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toEqual([
      {
        content: "Where should the module go?",
        role: "user",
        sessionId: "chatSessions_1"
      }
    ])
    expect(getMutationArgs(runMutation, "search:saveEvidence")).toEqual([])
  })

  it("returns a temporary capacity error when Mercury success accounting fails", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Where should the module go?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "Install the module beside the controller.",
          pageNumber: 12,
          score: 0.97
        }
      ])
    const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1"], {
      throwOnProviderSuccessFor: "inception"
    })
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.97 }])

    await expect(
      askHandler._handler(
        {
          runMutation,
          runQuery,
          vectorSearch
        } as never,
        {
          question: "Where should the module go?",
          sessionAccessToken: "access-token-1",
          sessionId: "chatSessions_1" as never
        }
      )
    ).rejects.toThrow(/capacity|temporarily unavailable/i)

    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderTransientFailure")).toEqual([
      {
        keyId: "inception:1",
        provider: "inception"
      }
    ])
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toEqual([
      {
        content: "Where should the module go?",
        role: "user",
        sessionId: "chatSessions_1"
      }
    ])
  })

  it("sanitizes provider env setup failures before returning them to users", async () => {
    getProviderEnv.mockImplementationOnce(() => {
      throw new Error("JINA_API_KEYS is required")
    })
    const runQuery = vi.fn().mockResolvedValueOnce({
      _id: "chatSessions_1" as never,
      createdAt: 1,
      title: "Where should the module go?",
      updatedAt: 1
    })
    const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1"])
    const vectorSearch = vi.fn().mockResolvedValue([])

    let thrown: unknown
    try {
      await askHandler._handler(
        {
          runMutation,
          runQuery,
          vectorSearch
        } as never,
        {
          question: "Where should the module go?",
          sessionAccessToken: "access-token-1",
          sessionId: "chatSessions_1" as never
        }
      )
    } catch (error) {
      thrown = error
    }

    expect(getErrorMessage(thrown)).toMatch(/Embedding provider configuration needs administrator attention/i)
    expect(getErrorMessage(thrown)).not.toContain("JINA_API_KEYS")
    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(vectorSearch).not.toHaveBeenCalled()
  })

  it("sanitizes provider key-pool setup failures before returning them to users", async () => {
    buildProviderKeyPool.mockImplementationOnce(() => {
      throw new Error("JINA_API_KEYS is required")
    })
    const runQuery = vi.fn().mockResolvedValueOnce({
      _id: "chatSessions_1" as never,
      createdAt: 1,
      title: "Where should the module go?",
      updatedAt: 1
    })
    const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1"])
    const vectorSearch = vi.fn().mockResolvedValue([])

    let thrown: unknown
    try {
      await askHandler._handler(
        {
          runMutation,
          runQuery,
          vectorSearch
        } as never,
        {
          question: "Where should the module go?",
          sessionAccessToken: "access-token-1",
          sessionId: "chatSessions_1" as never
        }
      )
    } catch (error) {
      thrown = error
    }

    expect(getErrorMessage(thrown)).toMatch(/Embedding provider configuration needs administrator attention/i)
    expect(getErrorMessage(thrown)).not.toContain("JINA_API_KEYS")
    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(vectorSearch).not.toHaveBeenCalled()
  })

  it("passes Indonesian response-language instructions into grounded answer generation", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Bagaimana cara memasang modul ini?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Halaman 7",
          chunkId: "chunks_1" as never,
          content: "Pasang modul di samping kontroler.",
          pageNumber: 7,
          score: 0.97
        }
      ])

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.97 }])

    await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Bagaimana cara memasang modul ini?",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(generateGroundedAnswer).toHaveBeenCalledWith(
      "Bagaimana cara memasang modul ini?",
      expect.any(String),
      expect.objectContaining({ code: "id" }),
      expect.objectContaining({
        apiKey: "mercury-test-key-1",
        keyId: "inception:1"
      })
    )
  })

  it("grounds a lookup-style query from exact fallback when vector search misses", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Rockwell Automation",
        updatedAt: 1
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        exactPage([
          {
            assetId: "documentAssets_1" as never,
            citationLabel: "Page 12",
            chunkId: "chunks_1" as never,
            content: "Rockwell Automation",
            pageNumber: 12
          }
        ])
      )

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Rockwell Automation",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )
    expect(getMutationArgs(runMutation, "providerRateLimits:reserveProviderKey")).toContainEqual(
      expect.objectContaining({
        estimatedOutputTokens: 8_192,
        outputTpmLimit: 9_000,
        provider: "inception"
      })
    )

    expect(runQuery).toHaveBeenCalledTimes(4)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.citations).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 12",
        chunkId: "chunks_1",
        pageNumber: 12
      }
    ])
  })

  it("rotates the session bearer token on a successful follow-up answer", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Where should the module go?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "Install the module beside the controller.",
          pageNumber: 12,
          score: 0.97
        }
      ])

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.97 }])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Where should the module go?",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.sessionAccessToken).toBe("access-token-2")
  })

  it("merges vector and exact candidates without duplicates", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Rockwell Automation",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "vector result",
          pageNumber: 12,
          score: 0.42
        },
        {
          assetId: "documentAssets_2" as never,
          citationLabel: "Page 18",
          chunkId: "chunks_2" as never,
          content: "vector-only result",
          pageNumber: 18,
          score: 0.4
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        exactPage([
          {
            assetId: "documentAssets_1" as never,
            citationLabel: "Page 12",
            chunkId: "chunks_1" as never,
            content: "Rockwell Automation exact result",
            pageNumber: 12
          }
        ])
      )

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([
      { _id: "chunkEmbeddings_1" as never, _score: 0.42 },
      { _id: "chunkEmbeddings_2" as never, _score: 0.4 }
    ])

    await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Rockwell Automation",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledTimes(4)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)

    const context = generateGroundedAnswer.mock.calls[0]?.[1] as string
    expect(context).toContain("[E1] Page 12: Rockwell Automation exact result")
    expect(context).not.toContain("vector result")
    expect(context.match(/Page 12/g)).toHaveLength(1)
  })

  it("keeps the stronger vector candidate when exact fallback is weaker", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Page 12,",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "vector result",
          pageNumber: 12,
          score: 0.99
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        exactPage([
          {
            assetId: "documentAssets_1" as never,
            citationLabel: "Page 12",
            chunkId: "chunks_1" as never,
            content: "Reference note",
            pageNumber: 12
          }
        ])
      )

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.99 }])

    await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Page 12,",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    const context = generateGroundedAnswer.mock.calls[0]?.[1] as string
    expect(context).toContain("vector result")
    expect(context).not.toContain("exact result")
  })

  it("returns a refusal packet when neither path finds evidence", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Where should the module go?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Where should the module go?",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledTimes(4)
    expect(packet.answerabilityStatus).toBe("insufficient_evidence")
    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toHaveLength(2)
  })

  it("returns an Indonesian refusal packet when neither path finds evidence", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Bagaimana cara memasang modul ini?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Bagaimana cara memasang modul ini?",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(packet.answerabilityStatus).toBe("insufficient_evidence")
    expect(packet.answerSummary).toMatch(/Saya tidak menemukan bukti/)
  })

  it("loads multiple global exact pages through the action", async () => {
    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Open the drive settings."],
      answerSummary: "PowerFlex 755 guidance found.",
      citationIds: ["E1"]
    })

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "powerflex 755",
        updatedAt: 1
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        exactPage(
          [
            {
              assetId: "documentAssets_1" as never,
              citationLabel: "Page 3",
              chunkId: "chunks_1" as never,
              content: "PowerFlex 755 drives support this workflow.",
              pageNumber: 3
            }
          ],
          { continueCursor: "cursor_1", isDone: false }
        )
      )
      .mockResolvedValueOnce(
        exactPage([
          {
            assetId: "documentAssets_1" as never,
            citationLabel: "Page 4",
            chunkId: "chunks_2" as never,
            content: "More PowerFlex 755 guidance.",
            pageNumber: 4
          }
        ])
      )

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "powerflex 755",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledTimes(5)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(packet.answerabilityStatus).toBe("grounded")

    const context = generateGroundedAnswer.mock.calls.at(-1)?.[1] as string
    expect(context).toContain("Page 3")
    expect(context).toContain("Page 4")
  })

  it("grounds a global lookup from exact term matches without paginating arbitrary chunk pages", async () => {
    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Open the drive settings."],
      answerSummary: "Rockwell Automation guidance found.",
      citationIds: ["E1"]
    })

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Rockwell Automation",
        updatedAt: 1
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "Rockwell Automation configuration details.",
          pageNumber: 12,
          score: 1
        }
      ])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Rockwell Automation",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(packet.answerabilityStatus).toBe("grounded")
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(runQuery).toHaveBeenCalledTimes(4)
  })

  it("filters vector search to the current document scope when documentId is provided", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "Where should the module go?",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 12",
          chunkId: "chunks_1" as never,
          content: "Install the module beside the controller.",
          pageNumber: 12,
          score: 0.4
        }
      ])
      .mockResolvedValueOnce([])

    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])

    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.4 }])

    await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        documentId: "documents_1" as never,
        question: "Rockwell Automation",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledTimes(3)
    expect(vectorSearch).toHaveBeenCalledWith(
      "chunkEmbeddings",
      "by_embedding",
      expect.objectContaining({
        limit: 24
      })
    )

    const options = vectorSearch.mock.calls[0][2] as { filter: (builder: { eq: (field: string, value: string) => void }) => void }
    const eq = vi.fn()

    options.filter({ eq })

    expect(eq).toHaveBeenCalledWith("documentCurrentKey", "documents_1:current")
  })
})
