import { describe, expect, it } from "vitest"

import { defaultEvaluationCases } from "./evaluationSeed"

describe("defaultEvaluationCases", () => {
  it("covers the required SP1 categories", () => {
    expect(defaultEvaluationCases.map((item) => item.category)).toEqual(
      expect.arrayContaining(["exact-lookup", "table-reasoning", "diagram-reasoning", "not-found"])
    )
  })
})
