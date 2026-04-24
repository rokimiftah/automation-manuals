import { describe, expect, it } from "vitest"

import { isLookupLikeQuery, mergeCandidates, rankExactCandidates } from "./hybridRetrieval"

describe("isLookupLikeQuery", () => {
  it("returns true for short product-style lookups", () => {
    expect(isLookupLikeQuery("HP LaserJet M404dn")).toBe(true)
  })

  it("returns true for quoted phrases and identifiers", () => {
    expect(isLookupLikeQuery('"laserjet m404dn"')).toBe(true)
    expect(isLookupLikeQuery("AB-1234-XY")).toBe(true)
    expect(isLookupLikeQuery("Wi-Fi 6E")).toBe(true)
    expect(isLookupLikeQuery("München Geräte")).toBe(true)
    expect(isLookupLikeQuery("Power BI")).toBe(true)
    expect(isLookupLikeQuery("PCI DSS")).toBe(true)
  })

  it("returns false for mixed quoted broad questions", () => {
    expect(isLookupLikeQuery('How do I install "Rockwell Automation"?')).toBe(false)
  })

  it("returns false for mixed quoted commands", () => {
    expect(isLookupLikeQuery('Install "Rockwell Automation"')).toBe(false)
    expect(isLookupLikeQuery('Please search "Rockwell Automation"')).toBe(false)
  })

  it("returns false for broad natural-language questions", () => {
    expect(isLookupLikeQuery("How do I fix the printer jam?")).toBe(false)
    expect(isLookupLikeQuery("OpenAI API")).toBe(false)
    expect(isLookupLikeQuery("Project Status")).toBe(false)
    expect(isLookupLikeQuery("Customer Success")).toBe(false)
    expect(isLookupLikeQuery("Enable Logging")).toBe(false)
    expect(isLookupLikeQuery("Open Console")).toBe(false)
    expect(isLookupLikeQuery("Show Notes")).toBe(false)
  })

  it("returns false for question-style identifier queries", () => {
    expect(isLookupLikeQuery("What is Wi-Fi 6E?")).toBe(false)
  })

  it("returns false for imperative identifier commands", () => {
    expect(isLookupLikeQuery("Configure Wi-Fi 6E")).toBe(false)
    expect(isLookupLikeQuery("Update AB-1234")).toBe(false)
    expect(isLookupLikeQuery("Edit AB-1234")).toBe(false)
    expect(isLookupLikeQuery("Compare Wi-Fi 6E")).toBe(false)
    expect(isLookupLikeQuery("Enable logging")).toBe(false)
    expect(isLookupLikeQuery("Restart services")).toBe(false)
    expect(isLookupLikeQuery("Open console")).toBe(false)
  })
})

describe("rankExactCandidates", () => {
  it("returns only literal matches", () => {
    const ranked = rankExactCandidates("HP LaserJet M404dn", [
      {
        citationLabel: "Page 4",
        chunkId: "chunk-partial",
        content: "LaserJet maintenance guide for M404dn devices",
        pageNumber: 4
      },
      {
        citationLabel: "Page 5",
        chunkId: "chunk-exact",
        content: "HP LaserJet M404dn paper jam recovery steps",
        pageNumber: 5
      }
    ])

    expect(ranked[0]?.chunkId).toBe("chunk-exact")
    expect(ranked).toHaveLength(1)
  })

  it("handles hyphenated literal matches", () => {
    const ranked = rankExactCandidates("Wi-Fi 6E", [
      {
        citationLabel: "Page 8",
        chunkId: "chunk-wifi",
        content: "Install the Wi Fi 6E access point module",
        pageNumber: 8
      }
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.chunkId).toBe("chunk-wifi")
  })

  it("matches citation labels literally", () => {
    const ranked = rankExactCandidates("Page 12", [
      {
        citationLabel: "Page 12",
        chunkId: "chunk-label",
        content: "Reference note",
        pageNumber: 12
      }
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.chunkId).toBe("chunk-label")
  })

  it("handles punctuation-normalized exact matches", () => {
    const ranked = rankExactCandidates("Page 12,", [
      {
        citationLabel: "Page 12",
        chunkId: "chunk-punct",
        content: "Reference note",
        pageNumber: 12
      }
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.score).toBe(0.95)
  })

  it("does not match label supersets", () => {
    const ranked = rankExactCandidates("Page 1", [
      {
        citationLabel: "Page 12",
        chunkId: "chunk-superset",
        content: "Reference note",
        pageNumber: 12
      }
    ])

    expect(ranked).toHaveLength(0)
  })
})

describe("mergeCandidates", () => {
  it("dedupes by chunkId and keeps the stronger candidate", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 7",
          chunkId: "chunk-a",
          content: "vector result",
          pageNumber: 7,
          score: 0.42
        }
      ],
      [
        {
          citationLabel: "Page 7",
          chunkId: "chunk-a",
          content: "exact result",
          pageNumber: 7,
          score: 0.91
        }
      ]
    )

    expect(merged).toEqual([
      {
        citationLabel: "Page 7",
        chunkId: "chunk-a",
        content: "exact result",
        pageNumber: 7,
        score: 0.91
      }
    ])
  })

  it("prefers exact matches on equal scores", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 2",
          chunkId: "chunk-b",
          content: "vector result",
          pageNumber: 2,
          score: 0.8
        }
      ],
      [
        {
          citationLabel: "Page 2",
          chunkId: "chunk-b",
          content: "exact result",
          pageNumber: 2,
          score: 0.8
        }
      ]
    )

    expect(merged).toEqual([
      {
        citationLabel: "Page 2",
        chunkId: "chunk-b",
        content: "exact result",
        pageNumber: 2,
        score: 0.8
      }
    ])
  })

  it("keeps the stronger vector match when exact is weaker", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 3",
          chunkId: "chunk-shared",
          content: "vector result",
          pageNumber: 3,
          score: 0.99
        }
      ],
      [
        {
          citationLabel: "Page 3",
          chunkId: "chunk-shared",
          content: "exact result",
          pageNumber: 3,
          score: 0.8
        }
      ]
    )

    expect(merged).toEqual([
      {
        citationLabel: "Page 3",
        chunkId: "chunk-shared",
        content: "vector result",
        pageNumber: 3,
        score: 0.99
      }
    ])
  })

  it("keeps the stronger vector match when exact appears later", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 3",
          chunkId: "chunk-shared-late",
          content: "vector result",
          pageNumber: 3,
          score: 0.99
        }
      ],
      [
        {
          citationLabel: "Page 3",
          chunkId: "chunk-shared-late",
          content: "exact result",
          pageNumber: 3,
          score: 0.8
        }
      ]
    )

    expect(merged).toEqual([
      {
        citationLabel: "Page 3",
        chunkId: "chunk-shared-late",
        content: "vector result",
        pageNumber: 3,
        score: 0.99
      }
    ])
  })

  it("orders same-score candidates deterministically", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 9",
          chunkId: "chunk-z",
          content: "vector result z",
          pageNumber: 9,
          score: 0.5
        },
        {
          citationLabel: "Page 4",
          chunkId: "chunk-a",
          content: "vector result a",
          pageNumber: 4,
          score: 0.5
        }
      ],
      []
    )

    expect(merged.map((candidate) => candidate.chunkId)).toEqual(["chunk-a", "chunk-z"])
  })

  it("orders vector and exact matches consistently", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 7",
          chunkId: "chunk-vector",
          content: "vector result",
          pageNumber: 7,
          score: 0.7
        }
      ],
      [
        {
          citationLabel: "Page 8",
          chunkId: "chunk-exact",
          content: "exact result",
          pageNumber: 8,
          score: 0.9
        }
      ]
    )

    expect(merged.map((candidate) => candidate.chunkId)).toEqual(["chunk-exact", "chunk-vector"])
  })

  it("prefers exact matches ahead of vector ties", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 7",
          chunkId: "chunk-vector-tie",
          content: "vector result",
          pageNumber: 7,
          score: 0.9
        }
      ],
      [
        {
          citationLabel: "Page 8",
          chunkId: "chunk-exact-tie",
          content: "exact result",
          pageNumber: 8,
          score: 0.9
        }
      ]
    )

    expect(merged.map((candidate) => candidate.chunkId)).toEqual(["chunk-exact-tie", "chunk-vector-tie"])
  })

  it("orders same-source exact ties deterministically", () => {
    const merged = mergeCandidates(
      [],
      [
        {
          citationLabel: "Page 11",
          chunkId: "chunk-exact-b",
          content: "exact result b",
          pageNumber: 11,
          score: 0.8
        },
        {
          citationLabel: "Page 10",
          chunkId: "chunk-exact-a",
          content: "exact result a",
          pageNumber: 10,
          score: 0.8
        }
      ]
    )

    expect(merged.map((candidate) => candidate.chunkId)).toEqual(["chunk-exact-a", "chunk-exact-b"])
  })

  it("orders numeric page ties naturally", () => {
    const merged = mergeCandidates(
      [
        {
          citationLabel: "Page 10",
          chunkId: "chunk-page-10",
          content: "vector result 10",
          pageNumber: 10,
          score: 0.6
        },
        {
          citationLabel: "Page 2",
          chunkId: "chunk-page-2",
          content: "vector result 2",
          pageNumber: 2,
          score: 0.6
        }
      ],
      []
    )

    expect(merged.map((candidate) => candidate.chunkId)).toEqual(["chunk-page-2", "chunk-page-10"])
  })
})
