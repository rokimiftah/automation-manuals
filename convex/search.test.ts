import { describe, expect, it } from "vitest"

import { DOCUMENT_SCOPED_VECTOR_LIMIT, getTopEvidenceScore, getVectorSearchLimit } from "./search"

describe("getVectorSearchLimit", () => {
  it("returns the document-scoped vector limit when documentId is provided", () => {
    expect(getVectorSearchLimit("documents_1" as never)).toBe(DOCUMENT_SCOPED_VECTOR_LIMIT)
  })

  it("returns the default vector limit when documentId is undefined", () => {
    expect(getVectorSearchLimit(undefined)).toBe(6)
  })
})

describe("getTopEvidenceScore", () => {
  it("returns the highest score from the evidence set", () => {
    expect(getTopEvidenceScore([{ score: 0.58 }, { score: 0.73 }, { score: 0.64 }])).toBe(0.73)
  })

  it("returns zero when there is no evidence", () => {
    expect(getTopEvidenceScore([])).toBe(0)
  })
})
