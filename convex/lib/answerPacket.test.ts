import { describe, expect, it } from "vitest"

import { buildClarificationPacket, buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./answerPacket"

describe("buildRefusalPacket", () => {
  it("builds refusal packets from generated summary text", () => {
    const packet = buildRefusalPacket("sessions_1" as never, "access-token", "証拠が不足しています。")

    expect(packet).toMatchObject({
      answerabilityStatus: "insufficient_evidence",
      answerSummary: "証拠が不足しています。",
      answerSteps: [],
      citations: [],
      supportingAssets: []
    })
  })
})

describe("buildGroundedPacket", () => {
  it("keeps only evidence explicitly selected by the model", () => {
    const evidence = [
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 12",
        chunkId: "chunks_1" as never,
        evidenceId: "E1",
        pageNumber: 12,
        score: 0.97
      },
      {
        assetId: "documentAssets_2" as never,
        citationLabel: "Page 18",
        chunkId: "chunks_2" as never,
        evidenceId: "E2",
        pageNumber: 18,
        score: 0.95
      }
    ]

    expect(selectEvidenceByCitationIds(evidence, ["E2"])).toEqual([evidence[1]])
    expect(selectEvidenceByCitationIds(evidence, ["E9"])).toEqual([])
  })

  it("normalizes bracketed or case-variant citation identifiers", () => {
    const evidence = [
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 12",
        chunkId: "chunks_1" as never,
        evidenceId: "E1",
        pageNumber: 12,
        score: 0.97
      }
    ]

    expect(selectEvidenceByCitationIds(evidence, ["[e1]"])).toEqual(evidence)
  })

  it("preserves model citation order when selecting evidence", () => {
    const evidence = [
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 12",
        chunkId: "chunks_1" as never,
        evidenceId: "E1",
        pageNumber: 12,
        score: 0.97
      },
      {
        assetId: "documentAssets_2" as never,
        citationLabel: "Page 18",
        chunkId: "chunks_2" as never,
        evidenceId: "E2",
        pageNumber: 18,
        score: 0.95
      }
    ]

    expect(selectEvidenceByCitationIds(evidence, ["E2", "E1"])).toEqual([evidence[1], evidence[0]])
  })

  it("keeps chunk-level citations while deduplicating supporting assets", () => {
    expect(
      buildGroundedPacket(
        "chatSessions_1" as never,
        "access-token-1",
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
          citationLabel: "Page 12",
          chunkId: "chunks_2",
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
      sessionAccessToken: "access-token-1",
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

  it("keeps citation granularity by chunk id even on the same page", () => {
    expect(
      buildGroundedPacket(
        "chatSessions_1" as never,
        "access-token-1",
        "Install the module beside the controller.",
        ["Check the chassis"],
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
          }
        ]
      )
    ).toEqual({
      answerSteps: ["Check the chassis"],
      answerSummary: "Install the module beside the controller.",
      answerabilityStatus: "grounded",
      citations: [
        {
          assetId: "documentAssets_1",
          citationLabel: "Page 12",
          chunkId: "chunks_1",
          pageNumber: 12
        },
        {
          assetId: "documentAssets_1",
          citationLabel: "Page 12",
          chunkId: "chunks_2",
          pageNumber: 12
        }
      ],
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1",
      supportingAssets: [
        {
          assetId: "documentAssets_1",
          label: "Page 12",
          pageNumber: 12
        }
      ]
    })
  })
})

describe("buildClarificationPacket", () => {
  it("returns a citation-free packet that asks one focused follow-up question", () => {
    expect(
      buildClarificationPacket(
        "chatSessions_1" as never,
        "access-token-1",
        "Installation fault F002 after first power-on.",
        "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter."
      )
    ).toEqual({
      answerSteps: [],
      answerSummary: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
      answerabilityStatus: "needs_clarification",
      citations: [],
      clarifyingQuestion: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
      interpretedProblem: "Installation fault F002 after first power-on.",
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1",
      supportingAssets: []
    })
  })
})
