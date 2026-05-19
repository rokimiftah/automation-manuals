import { describe, expect, it } from "vitest"

import { defaultEvaluationCases } from "./evaluationSeed"

describe("defaultEvaluationCases", () => {
  it("covers the required SP1 categories", () => {
    expect(defaultEvaluationCases.map((item) => item.category)).toEqual(
      expect.arrayContaining(["exact-lookup", "table-reasoning", "diagram-reasoning", "not-found"])
    )
  })

  it("includes multi-vendor diagnostic ambiguity cases", () => {
    expect(defaultEvaluationCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "multi-vendor-clarification",
          expectedAnswerabilityStatus: "needs_clarification",
          expectedRefusal: true,
          severity: "operational",
          slug: "multi-vendor-f002-missing-scope"
        }),
        expect.objectContaining({
          category: "error-code-collision",
          expectedAnswerabilityStatus: "needs_clarification",
          expectedRefusal: true,
          severity: "operational",
          slug: "multi-vendor-error-code-collision"
        })
      ])
    )
  })
})
