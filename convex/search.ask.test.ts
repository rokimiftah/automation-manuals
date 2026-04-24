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
      sessionId: never
    }
  ) => Promise<{
    answerSteps: string[]
    answerSummary: string
    answerabilityStatus: "grounded" | "insufficient_evidence"
    citations: Array<{ chunkId: never; pageNumber: number; citationLabel: string; assetId?: never }>
    sessionId: never
    supportingAssets: Array<{ assetId: never; label: string; pageNumber: number }>
  }>
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

  it("keeps a document-grounded answer even when evidence scores are below the old cutoff", async () => {
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
        sessionId: "chatSessions_1" as never
      }
    )

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
})
