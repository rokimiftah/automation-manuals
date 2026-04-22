import { describe, expect, it } from "vitest"

import { buildGroundedPacket, buildRefusalPacket } from "./answerPacket"

describe("buildRefusalPacket", () => {
  it("returns an empty citation packet for insufficient evidence", () => {
    expect(
      buildRefusalPacket("chatSessions_1" as never)
    ).toEqual({
      answerSteps: [],
      answerSummary: "I could not find enough evidence in the official documentation to answer that safely.",
      answerabilityStatus: "insufficient_evidence",
      citations: [],
      sessionId: "chatSessions_1",
      supportingAssets: []
    })
  })
})

describe("buildGroundedPacket", () => {
  it("deduplicates citations and supporting assets", () => {
    expect(
      buildGroundedPacket(
        "chatSessions_1" as never,
        "Install the module beside the controller.",
        ["Check the chassis", "Tighten the mounting rail"],
        [
          {
            assetId: "documentAssets_1" as never,
            citationLabel: "Page 12",
            chunkId: "chunks_1" as never,
            pageNumber: 12,
            score: 0.97
          },
          {
            assetId: "documentAssets_1" as never,
            citationLabel: "Page 12",
            chunkId: "chunks_2" as never,
            pageNumber: 12,
            score: 0.95
          },
          {
            assetId: "documentAssets_2" as never,
            citationLabel: "Page 18",
            chunkId: "chunks_3" as never,
            pageNumber: 18,
            score: 0.93
          }
        ]
      )
    ).toEqual({
      answerSteps: ["Check the chassis", "Tighten the mounting rail"],
      answerSummary: "Install the module beside the controller.",
      answerabilityStatus: "grounded",
      citations: [
        {
          citationLabel: "Page 12",
          chunkId: "chunks_1",
          assetId: "documentAssets_1",
          pageNumber: 12
        },
        {
          citationLabel: "Page 18",
          chunkId: "chunks_3",
          assetId: "documentAssets_2",
          pageNumber: 18
        }
      ],
      sessionId: "chatSessions_1",
      supportingAssets: [
        {
          assetId: "documentAssets_1",
          label: "Page 12",
          pageNumber: 12
        },
        {
          assetId: "documentAssets_2",
          label: "Page 18",
          pageNumber: 18
        }
      ]
    })
  })
})
