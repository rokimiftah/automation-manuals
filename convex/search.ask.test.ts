import { beforeEach, describe, expect, it, vi } from "vitest"

import { ask } from "./search"

const { embedTexts, generateGroundedAnswer } = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  generateGroundedAnswer: vi.fn()
}))

vi.mock("./lib/mistral", async () => {
  const actual = await vi.importActual<typeof import("./lib/mistral")>("./lib/mistral")
  return {
    ...actual,
    embedTexts,
    generateGroundedAnswer
  }
})

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

describe("ask", () => {
  beforeEach(() => {
    embedTexts.mockReset()
    generateGroundedAnswer.mockReset()

    embedTexts.mockResolvedValue([[0.1, 0.2]])
    generateGroundedAnswer.mockResolvedValue({
      answerSteps: ["Check the chassis."],
      answerSummary: "Install the module beside the controller.",
      citationIds: ["E1"]
    })
  })

  it("creates a new session and returns the session access token", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(exactPage([]))
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" })
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
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
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
      .mockResolvedValueOnce(null)

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

    expect(runQuery).toHaveBeenCalledTimes(3)
    expect(vectorSearch).toHaveBeenCalledWith(
      "chunkEmbeddings",
      "by_embedding",
      expect.objectContaining({
        limit: 6
      })
    )
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(runMutation).toHaveBeenCalledTimes(3)
    expect(packet.answerabilityStatus).toBe("grounded")
    expect(packet.answerSummary).toBe("Install the module beside the controller.")
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

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
      .mockResolvedValueOnce(null)

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

    expect(runQuery).toHaveBeenCalledTimes(3)
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

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
      .mockResolvedValueOnce(null)

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

    expect(runQuery).toHaveBeenCalledTimes(3)
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

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
      .mockResolvedValueOnce(null)

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
      .mockResolvedValueOnce(exactPage([]))

    const runMutation = vi.fn().mockResolvedValueOnce("chatMessages_1").mockResolvedValueOnce("chatMessages_2")

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

    expect(runQuery).toHaveBeenCalledTimes(3)
    expect(packet.answerabilityStatus).toBe("insufficient_evidence")
    expect(generateGroundedAnswer).not.toHaveBeenCalled()
    expect(runMutation).toHaveBeenCalledTimes(2)
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

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
      .mockResolvedValueOnce(null)

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

    expect(runQuery).toHaveBeenCalledTimes(4)
    expect(generateGroundedAnswer).toHaveBeenCalledTimes(1)
    expect(packet.answerabilityStatus).toBe("grounded")

    const context = generateGroundedAnswer.mock.calls.at(-1)?.[1] as string
    expect(context).toContain("Page 3")
    expect(context).toContain("Page 4")
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

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("chatMessages_1")
      .mockResolvedValueOnce("chatMessages_2")
      .mockResolvedValueOnce(null)

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
