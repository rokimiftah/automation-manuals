import { getFunctionName } from "convex/server"
import { ConvexError } from "convex/values"

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import * as envModule from "./lib/env"
import * as inceptionModule from "./lib/inception"
import * as jinaModule from "./lib/jina"
import { ProviderPermanentError, ProviderRateLimitError } from "./lib/providerErrors"
import * as providerKeysModule from "./lib/providerKeys"

const buildProviderKeyPool = vi.spyOn(providerKeysModule, "buildProviderKeyPool")
const embedSearchQuery = vi.spyOn(jinaModule, "embedSearchQuery")
const generateClarifyingQuestion = vi.spyOn(inceptionModule, "generateClarifyingQuestion")
const generateEnglishQuestion = vi.spyOn(inceptionModule, "generateEnglishQuestion")
const generateGroundedAnswer = vi.spyOn(inceptionModule, "generateGroundedAnswer")
const generateInsufficientEvidenceSummary = vi.spyOn(inceptionModule, "generateInsufficientEvidenceSummary")
const getProviderEnv = vi.spyOn(envModule, "getProviderEnv")
const resolveProviderKey = vi.spyOn(providerKeysModule, "resolveProviderKey")

const { ask } = await import("./search")

const askHandler = ask as typeof ask & {
  _handler: (
    ctx: unknown,
    args: {
      documentId?: never
      previousInterpretedProblem?: string
      question: string
      sessionAccessToken?: string
      sessionId: never
    }
  ) => Promise<{
    answerSteps: string[]
    answerSummary: string
    answerabilityStatus: "grounded" | "insufficient_evidence" | "needs_clarification"
    citations: Array<{ chunkId: never; pageNumber: number; citationLabel: string; assetId?: never }>
    clarifyingQuestion?: string
    interpretedProblem?: string
    sessionAccessToken: string
    sessionId: never
    supportingAssets: Array<{ assetId: never; label: string; pageNumber: number }>
  }>
}

afterAll(() => {
  vi.restoreAllMocks()
})

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
  inceptionEstimatedOutputTokens: 1024,
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
    throwOnProviderAccountingFor?: string
    throwOnProviderSuccessAttempt?: number
    throwOnProviderSuccessFor?: "inception" | "jina"
  } = {}
) {
  const appResultQueue = [...appResults]
  let providerSuccessAttempts = 0

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
      if (functionName === options.throwOnProviderAccountingFor) {
        throw new Error("provider accounting write failed")
      }

      if (functionName === "providerRateLimits:recordProviderSuccess" && args.provider === options.throwOnProviderSuccessFor) {
        providerSuccessAttempts += 1
      }

      if (
        functionName === "providerRateLimits:recordProviderSuccess" &&
        args.provider === options.throwOnProviderSuccessFor &&
        providerSuccessAttempts === (options.throwOnProviderSuccessAttempt ?? 1)
      ) {
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

function expectEnglishOnlyPolicy() {
  return expect.objectContaining({
    instruction: expect.stringMatching(
      /Answer every natural-language assistant response field in English[\s\S]*Do not translate technical identifiers/
    )
  })
}

describe("ask", () => {
  beforeEach(() => {
    buildProviderKeyPool.mockClear()
    embedSearchQuery.mockReset()
    generateClarifyingQuestion.mockReset()
    generateEnglishQuestion.mockReset()
    generateGroundedAnswer.mockReset()
    generateInsufficientEvidenceSummary.mockReset()
    getProviderEnv.mockReset()
    resolveProviderKey.mockClear()

    getProviderEnv.mockReturnValue(defaultProviderEnv)
    embedSearchQuery.mockResolvedValue([0.1, 0.2])
    generateClarifyingQuestion.mockResolvedValue({
      clarifyingQuestion: "Please provide the vendor and model."
    })
    generateEnglishQuestion.mockImplementation(async (question: string) => ({ englishQuestion: question }))
    generateGroundedAnswer.mockResolvedValue({
      answerSteps: ["Check the chassis."],
      answerSummary: "Install the module beside the controller.",
      citationIds: ["E1"]
    })
    generateInsufficientEvidenceSummary.mockResolvedValue({
      answerSummary: "No sufficient official evidence was found."
    })
  })

  it("generates a clarification question for ambiguous installation fault codes", async () => {
    generateClarifyingQuestion.mockResolvedValueOnce({
      clarifyingQuestion: "Which vendor and model are you working with?",
      usage: {
        inputTokens: 41,
        outputTokens: 12
      }
    })

    const runQuery = vi.fn().mockResolvedValueOnce([
      {
        documentId: "documents_1" as never,
        language: "English",
        productSlug: "sinamics-g120",
        title: "SINAMICS G120 Operating Instructions",
        vendorSlug: "siemens",
        version: "v1"
      }
    ])
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
        question: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
        sessionId: undefined as never
      }
    )

    expect(packet.answerabilityStatus).toBe("needs_clarification")
    expect(packet.answerSummary).toBe("Which vendor and model are you working with?")
    expect(packet.clarifyingQuestion).toBe("Which vendor and model are you working with?")
    expect(packet.citations).toEqual([])
    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(generateClarifyingQuestion).toHaveBeenCalledWith(
      {
        interpretedProblem: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
        missingContext: ["vendor", "model"]
      },
      expectEnglishOnlyPolicy(),
      expect.objectContaining({
        apiKey: "mercury-test-key-1",
        keyId: "inception:1"
      })
    )
    expect(getMutationArgs(runMutation, "providerRateLimits:reserveProviderKey")).toContainEqual(
      expect.objectContaining({
        estimatedOutputTokens: 1_024,
        provider: "inception"
      })
    )
    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderSuccess")).toContainEqual(
      expect.objectContaining({
        inputTokens: 41,
        keyId: "inception:1",
        outputTokens: 12,
        provider: "inception"
      })
    )
    expect(vectorSearch).not.toHaveBeenCalled()
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toEqual([
      {
        content: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
        role: "user",
        sessionId: "chatSessions_1"
      },
      {
        answerabilityStatus: "needs_clarification",
        content: "Which vendor and model are you working with?",
        role: "assistant",
        sessionId: "chatSessions_1"
      }
    ])
  })

  it("uses an English interpreted problem fallback when canonicalization fallback needs clarification", async () => {
    const rawQuestion = "Saya install drive baru, setelah power on muncul F002. Motor belum jalan."
    generateEnglishQuestion.mockRejectedValueOnce(
      new ProviderRateLimitError({ keyId: "inception:1", provider: "inception", retryAfterMs: 1000 })
    )
    generateClarifyingQuestion.mockResolvedValueOnce({
      clarifyingQuestion: "Which vendor and model are you working with?"
    })

    const runQuery = vi.fn().mockResolvedValueOnce([
      {
        documentId: "documents_1" as never,
        language: "English",
        productSlug: "powerflex-755",
        title: "PowerFlex 755 User Manual",
        vendorSlug: "rockwell",
        version: "v1"
      }
    ])
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
        question: rawQuestion,
        sessionId: undefined as never
      }
    )

    expect(packet.answerabilityStatus).toBe("needs_clarification")
    expect(packet.interpretedProblem).toContain(
      "The question needs vendor and model context before official documentation can be selected."
    )
    expect(packet.interpretedProblem).toContain("F002")
    expect(packet.interpretedProblem).not.toBe(rawQuestion)
    expect(packet.interpretedProblem).not.toContain(rawQuestion)
    expect(packet.clarifyingQuestion).toBe("Which vendor and model are you working with?")
    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderRateLimit")).toContainEqual(
      expect.objectContaining({
        keyId: "inception:1",
        provider: "inception",
        retryAfterMs: 1000
      })
    )
    expect(getMutationArgs(runMutation, "chats:appendMessage")[0]).toEqual({
      content: rawQuestion,
      role: "user",
      sessionId: "chatSessions_1"
    })
    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(vectorSearch).not.toHaveBeenCalled()
  })

  it("generates a clarification before retrieval for no-code operational symptoms", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "sinamics-g120",
          title: "SINAMICS G120 Operating Instructions",
          vendorSlug: "siemens",
          version: "v1"
        }
      ])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 9",
          chunkId: "chunks_1" as never,
          content: "Generic motor troubleshooting guidance.",
          pageNumber: 9,
          score: 0.93
        }
      ])
    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null
    ])
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.93 }])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Motor belum jalan setelah power on",
        sessionId: undefined as never
      }
    )

    expect(packet.answerabilityStatus).toBe("needs_clarification")
    expect(packet.interpretedProblem).toBe("Motor belum jalan setelah power on")
    expect(packet.answerSummary).toBe("Please provide the vendor and model.")
    expect(packet.clarifyingQuestion).toBe("Please provide the vendor and model.")
    expect(packet.citations).toEqual([])
    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(generateClarifyingQuestion).toHaveBeenCalledWith(
      {
        interpretedProblem: "Motor belum jalan setelah power on",
        missingContext: ["vendor", "model"]
      },
      expectEnglishOnlyPolicy(),
      expect.objectContaining({
        apiKey: "mercury-test-key-1",
        keyId: "inception:1"
      })
    )
    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(getMutationArgs(runMutation, "providerRateLimits:reserveProviderKey")).toContainEqual(
      expect.objectContaining({ provider: "inception" })
    )
    expect(vectorSearch).not.toHaveBeenCalled()
  })

  it("continues retrieval for general informational lookups without clarification", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce([
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 2",
        chunkId: "chunks_1" as never,
        content: "Manual overview and product family summary.",
        pageNumber: 2,
        score: 0.93
      }
    ])
    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null
    ])
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.93 }])

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "manual overview",
        sessionId: undefined as never
      }
    )

    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.answerabilityStatus).not.toBe("needs_clarification")
    expect(embedSearchQuery).toHaveBeenCalledWith("manual overview", expect.any(Object))
    expect(vectorSearch).toHaveBeenCalledTimes(1)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
  })

  it("uses canonical English for retrieval and answer generation while preserving the raw user message", async () => {
    generateEnglishQuestion.mockResolvedValueOnce({
      englishQuestion: "How should I install this module?"
    })

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
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "module",
          title: "Module Installation Manual",
          vendorSlug: "automation",
          version: "v1"
        }
      ])
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

    expect(generateEnglishQuestion).toHaveBeenCalledWith(
      "Bagaimana cara memasang modul ini?",
      expect.objectContaining({ keyId: "inception:1" })
    )
    expect(embedSearchQuery).toHaveBeenCalledWith("How should I install this module?", expect.any(Object))
    expect(generateGroundedAnswer).toHaveBeenCalledWith(
      "How should I install this module?",
      expect.any(String),
      expectEnglishOnlyPolicy(),
      expect.objectContaining({ keyId: "inception:1" })
    )
    expect(getMutationArgs(runMutation, "chats:appendMessage")[0]).toEqual({
      content: "Bagaimana cara memasang modul ini?",
      role: "user",
      sessionId: "chatSessions_1"
    })
  })

  it("falls back to the raw question when canonicalization rate-limit accounting fails", async () => {
    generateEnglishQuestion.mockRejectedValueOnce(
      new ProviderRateLimitError({ keyId: "inception:1", provider: "inception", retryAfterMs: 1000 })
    )

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

    const runMutation = createRunMutation(
      [{ allowed: true }, "chatMessages_1", "chatMessages_2", null, { sessionAccessToken: "access-token-2" }],
      { throwOnProviderAccountingFor: "providerRateLimits:recordProviderRateLimit" }
    )
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

    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderRateLimit")).toContainEqual(
      expect.objectContaining({
        keyId: "inception:1",
        provider: "inception",
        retryAfterMs: 1000
      })
    )
    expect(embedSearchQuery).toHaveBeenCalledWith("Where should the module go?", expect.any(Object))
    expect(packet.answerabilityStatus).toBe("grounded")
  })

  it("resumes clarification follow-up with the prior interpreted problem as retrieval context", async () => {
    const previousInterpretedProblem = "Saya install drive baru, setelah power on muncul F002. Motor belum jalan."
    const followUp = "Siemens SINAMICS G120"
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: previousInterpretedProblem,
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "sinamics-g120",
          title: "SINAMICS G120 Operating Instructions",
          vendorSlug: "siemens",
          version: "v1"
        }
      ])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 42",
          chunkId: "chunks_1" as never,
          content: "F002 troubleshooting instructions for SINAMICS G120.",
          pageNumber: 42,
          score: 0.4
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(exactPage([]))
    const runMutation = createRunMutation([
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null,
      { sessionAccessToken: "access-token-2" }
    ])
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.4 }])

    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Check the cited SINAMICS fault table."],
      answerSummary: "F002 is answered from the SINAMICS G120 evidence.",
      citationIds: ["E1"]
    })

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        previousInterpretedProblem,
        question: followUp,
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.answerabilityStatus).not.toBe("needs_clarification")
    expect(runQuery).toHaveBeenNthCalledWith(3, expect.anything(), {
      matches: [{ _id: "chunkEmbeddings_1", _score: 0.4 }],
      scope: {
        productSlug: "sinamics-g120",
        vendorSlug: "siemens"
      }
    })
    expect(runQuery).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      expect.objectContaining({
        question: expect.stringContaining("F002"),
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        },
        terms: expect.arrayContaining(["f002"])
      })
    )
    const effectiveQuestion = embedSearchQuery.mock.calls[0]?.[0] as string
    expect(effectiveQuestion).toContain("F002")
    expect(effectiveQuestion).toContain("Siemens SINAMICS G120")
    expect(embedSearchQuery).toHaveBeenCalledWith(effectiveQuestion, expect.any(Object))
    expect(generateGroundedAnswer).toHaveBeenCalledWith(
      effectiveQuestion,
      expect.any(String),
      expect.any(Object),
      expect.any(Object)
    )
    expect(getMutationArgs(runMutation, "chats:appendMessage")[0]).toEqual({
      content: followUp,
      role: "user",
      sessionId: "chatSessions_1"
    })
  })

  it("continues retrieval for non-diagnostic identifier lookups", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "sinamics-g120",
          title: "SINAMICS G120 Operating Instructions",
          vendorSlug: "siemens",
          version: "v1"
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 8",
          chunkId: "chunks_1" as never,
          content: "1756-L7SP catalog identifier details.",
          pageNumber: 8,
          score: 1
        }
      ])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null
    ])
    const vectorSearch = vi.fn().mockResolvedValue([])

    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Open the catalog reference."],
      answerSummary: "1756-L7SP is answered from the catalog evidence.",
      citationIds: ["E1"]
    })

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "1756-L7SP",
        sessionId: undefined as never
      }
    )

    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.answerabilityStatus).not.toBe("needs_clarification")
    expect(embedSearchQuery).toHaveBeenCalledWith("1756-L7SP", expect.any(Object))
    expect(vectorSearch).toHaveBeenCalledTimes(1)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
  })

  it("passes detected vendor and product scope into retrieval for known multi-vendor fault questions", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "sinamics-g120",
          title: "SINAMICS G120 Operating Instructions",
          vendorSlug: "siemens",
          version: "v1"
        }
      ])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 42",
          chunkId: "chunks_1" as never,
          content: "F002 troubleshooting instructions for SINAMICS G120.",
          pageNumber: 42,
          score: 0.93
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null
    ])
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.93 }])

    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Check the cited SINAMICS fault table."],
      answerSummary: "F002 is answered from the SINAMICS G120 evidence.",
      citationIds: ["E1"]
    })

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Siemens SINAMICS G120 F002 after first power on",
        sessionId: undefined as never
      }
    )

    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.citations).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 42",
        chunkId: "chunks_1",
        pageNumber: 42
      }
    ])
    expect(runQuery).toHaveBeenNthCalledWith(2, expect.anything(), {
      matches: [{ _id: "chunkEmbeddings_1", _score: 0.93 }],
      scope: {
        productSlug: "sinamics-g120",
        vendorSlug: "siemens"
      }
    })
    expect(vectorSearch).toHaveBeenCalledWith(
      "chunkEmbeddings",
      "by_embedding",
      expect.objectContaining({
        limit: 6,
        vector: [0.1, 0.2]
      })
    )
    const vectorOptions = vectorSearch.mock.calls[0]?.[2] as {
      filter: (builder: { eq: (field: string, value: boolean | string) => void }) => void
    }
    const eq = vi.fn()
    vectorOptions.filter({ eq })
    expect(eq).toHaveBeenCalledWith("productSlug", "sinamics-g120")
  })

  it("uses canonical English terms for exact fallback", async () => {
    generateEnglishQuestion.mockResolvedValueOnce({
      englishQuestion: "PowerFlex 755 fault F002 after first power on"
    })

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "F002 setelah power on pertama",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "powerflex-755",
          title: "PowerFlex 755 Manual",
          vendorSlug: "rockwell-automation",
          version: "v1"
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 214",
          chunkId: "chunks_f002" as never,
          content: "Fault F002 table for PowerFlex 755 first power on.",
          pageNumber: 214,
          score: 0.9
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

    await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Rockwell PowerFlex 755 F002 setelah power on pertama",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        question: "PowerFlex 755 fault F002 after first power on",
        terms: expect.arrayContaining(["f002", "powerflex 755"])
      })
    )
  })

  it("includes raw strong identifiers in global exact fallback terms when canonical English drops them", async () => {
    generateEnglishQuestion.mockResolvedValueOnce({
      englishQuestion:
        "PowerFlex 755 reference catalog specification overview dimensions options accessories ratings details maintenance notes"
    })

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "PowerFlex 755 F002 setelah power on pertama",
        updatedAt: 1
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 214",
          chunkId: "chunks_f002" as never,
          content: "Fault F002 table for PowerFlex 755 first power on.",
          pageNumber: 214,
          score: 0.9
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

    await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "PowerFlex 755 F002 setelah power on pertama",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        question:
          "PowerFlex 755 reference catalog specification overview dimensions options accessories ratings details maintenance notes",
        terms: expect.arrayContaining(["f002"])
      })
    )
    const exactCall = runQuery.mock.calls.find(([, args]) => Array.isArray((args as { terms?: unknown }).terms))
    const terms = (exactCall?.[1] as { terms: string[] }).terms
    expect(terms.slice(0, 12)).toContain("f002")
  })

  it("runs exact fallback for scoped operational diagnostics even when vector evidence is strong", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          documentId: "documents_1" as never,
          language: "English",
          productSlug: "sinamics-g120",
          title: "SINAMICS G120 Operating Instructions",
          vendorSlug: "siemens",
          version: "v1"
        }
      ])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "Page 18",
          chunkId: "chunks_generic" as never,
          content: "Generic first power-on checklist for SINAMICS drives.",
          pageNumber: 18,
          score: 0.98
        }
      ])
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_2" as never,
          citationLabel: "Page 214",
          chunkId: "chunks_f002" as never,
          content: "Fault F002 table: DC link overvoltage after first power on.",
          pageNumber: 214,
          score: 0.9
        }
      ])
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = createRunMutation([
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null
    ])
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.98 }])

    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Use the F002 fault table."],
      answerSummary: "F002 is grounded by the exact fault table.",
      citationIds: ["E2"]
    })

    const packet = await askHandler._handler(
      {
        runMutation,
        runQuery,
        vectorSearch
      } as never,
      {
        question: "Siemens SINAMICS G120 F002 after first power on",
        sessionId: undefined as never
      }
    )

    expect(runQuery).toHaveBeenCalledTimes(4)
    expect(runQuery).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        question: "Siemens SINAMICS G120 F002 after first power on",
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        },
        terms: expect.arrayContaining(["f002"])
      })
    )

    const context = generateGroundedAnswer.mock.calls[0]?.[1] as string
    expect(context).toContain("Generic first power-on checklist for SINAMICS drives.")
    expect(context).toContain("Fault F002 table: DC link overvoltage after first power on.")
    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.citations).toEqual([
      {
        assetId: "documentAssets_2",
        citationLabel: "Page 214",
        chunkId: "chunks_f002",
        pageNumber: 214
      }
    ])
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
    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: ["Check the chassis."],
      answerSummary: "Install the module beside the controller.",
      citationIds: ["E1"],
      usage: {
        inputTokens: 211,
        outputTokens: 33
      }
    })

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
      expectEnglishOnlyPolicy(),
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
    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderSuccess")).toContainEqual(
      expect.objectContaining({
        inputTokens: 211,
        keyId: "inception:2",
        outputTokens: 33,
        provider: "inception",
        reservedInputTokens: expect.any(Number),
        reservedOutputTokens: 1024
      })
    )
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toHaveLength(2)
    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.answerSummary).toBe("Install the module beside the controller.")
  })

  it("releases the estimated output token reservation when Mercury omits usage", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce([
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
      { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
      { allowed: true },
      "chatMessages_1",
      "chatMessages_2",
      null
    ])
    const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.97 }])

    await askHandler._handler(
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

    const successWrites = getMutationArgs(runMutation, "providerRateLimits:recordProviderSuccess")
    const answerSuccess = successWrites.filter((args) => args.provider === "inception").at(-1)
    const outputTokens = answerSuccess?.outputTokens
    expect(answerSuccess).toMatchObject({
      keyId: "inception:1",
      outputTokens: expect.any(Number),
      provider: "inception",
      reservedOutputTokens: 1024
    })
    expect(outputTokens).toBeLessThan(8192)
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

  it("continues when Mercury success accounting fails after provider success", async () => {
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
    const runMutation = createRunMutation(
      [{ allowed: true }, "chatMessages_1", "chatMessages_2", null, { sessionAccessToken: "access-token-2" }],
      {
        throwOnProviderSuccessAttempt: 2,
        throwOnProviderSuccessFor: "inception"
      }
    )
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

    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(packet.answerabilityStatus).toBe("grounded")
    const inceptionSuccessWrites = getMutationArgs(runMutation, "providerRateLimits:recordProviderSuccess").filter(
      (args) => args.provider === "inception"
    )
    expect(inceptionSuccessWrites.length).toBeGreaterThanOrEqual(2)
    expect(inceptionSuccessWrites.slice(0, 2)).toEqual([
      expect.objectContaining({
        keyId: "inception:1",
        provider: "inception"
      }),
      expect.objectContaining({
        keyId: "inception:1",
        provider: "inception"
      })
    ])
    expect(getMutationArgs(runMutation, "search:saveEvidence")).toHaveLength(1)
  })

  it("releases answer reservations without disabling keys for malformed answer responses", async () => {
    generateGroundedAnswer.mockRejectedValueOnce(new ProviderPermanentError({ provider: "inception" }))

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
    const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1"])
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
    ).rejects.toThrow(/configuration needs administrator attention/i)

    expect(getMutationArgs(runMutation, "providerRateLimits:disableProviderKey")).toEqual([])
    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderTransientFailure")).toEqual([
      {
        keyId: "inception:1",
        provider: "inception"
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

    expect(getErrorMessage(thrown)).toMatch(/Answer provider configuration needs administrator attention/i)
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

    expect(getErrorMessage(thrown)).toMatch(/Answer provider configuration needs administrator attention/i)
    expect(getErrorMessage(thrown)).not.toContain("JINA_API_KEYS")
    expect(embedSearchQuery).not.toHaveBeenCalled()
    expect(vectorSearch).not.toHaveBeenCalled()
  })

  it("passes English-only policy for non-Latin questions into grounded answer generation", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "chatSessions_1" as never,
        createdAt: 1,
        title: "このエラーを解除する方法は？",
        updatedAt: 1
      })
      .mockResolvedValueOnce([
        {
          assetId: "documentAssets_1" as never,
          citationLabel: "ページ 7",
          chunkId: "chunks_1" as never,
          content: "エラー解除手順はマニュアルに記載されています。",
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
        question: "このエラーを解除する方法は？",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(generateGroundedAnswer).toHaveBeenCalledWith(
      "このエラーを解除する方法は？",
      expect.any(String),
      expectEnglishOnlyPolicy(),
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
        estimatedOutputTokens: 1_024,
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

  it("uses generated refusal summary when neither retrieval path finds evidence", async () => {
    generateInsufficientEvidenceSummary.mockResolvedValueOnce({
      answerSummary: "I could not find enough official evidence to answer safely.",
      usage: {
        inputTokens: 29,
        outputTokens: 8
      }
    })

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
    expect(packet.answerSummary).toBe("I could not find enough official evidence to answer safely.")
    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(generateInsufficientEvidenceSummary).toHaveBeenCalledWith(
      "Where should the module go?",
      expectEnglishOnlyPolicy(),
      expect.objectContaining({
        apiKey: "mercury-test-key-1",
        keyId: "inception:1"
      })
    )
    expect(getMutationArgs(runMutation, "providerRateLimits:recordProviderSuccess")).toContainEqual(
      expect.objectContaining({
        inputTokens: 29,
        keyId: "inception:1",
        outputTokens: 8,
        provider: "inception"
      })
    )
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toHaveLength(2)
  })

  it("uses grounded answer summary when grounded answer lacks support", async () => {
    generateGroundedAnswer.mockResolvedValueOnce({
      answerSteps: [],
      answerSummary: "The retrieved official evidence is insufficient to answer this question.",
      citationIds: []
    })

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

    expect(packet.answerabilityStatus).toBe("insufficient_evidence")
    expect(packet.answerSummary).toBe("The retrieved official evidence is insufficient to answer this question.")
    expect(generateInsufficientEvidenceSummary).not.toHaveBeenCalled()
    expect(
      getMutationArgs(runMutation, "providerRateLimits:reserveProviderKey").filter((args) => args.provider === "inception")
    ).toHaveLength(2)
    expect(
      getMutationArgs(runMutation, "providerRateLimits:recordProviderSuccess").filter((args) => args.provider === "inception")
    ).toHaveLength(2)
    expect(getMutationArgs(runMutation, "chats:appendMessage")).toContainEqual(
      expect.objectContaining({
        answerabilityStatus: "insufficient_evidence",
        content: "The retrieved official evidence is insufficient to answer this question."
      })
    )
    expect(getMutationArgs(runMutation, "search:saveEvidence")).toEqual([])
  })

  it("uses generated refusal summary for Indonesian no-evidence questions", async () => {
    generateInsufficientEvidenceSummary.mockResolvedValueOnce({
      answerSummary: "I could not find enough official evidence to answer safely."
    })

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
    expect(packet.answerSummary).toBe("I could not find enough official evidence to answer safely.")
    expect(generateInsufficientEvidenceSummary).toHaveBeenCalledWith(
      "Bagaimana cara memasang modul ini?",
      expectEnglishOnlyPolicy(),
      expect.objectContaining({ keyId: "inception:1" })
    )
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

  it("grounds a global lookup from exact term matches with scanned-page fallback", async () => {
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
