import { describe, expect, it } from "vitest"

import { detectQuestionLanguage, getRefusalSummaryForLanguage } from "./questionLanguage"

describe("detectQuestionLanguage", () => {
  it("detects Indonesian questions", () => {
    expect(detectQuestionLanguage("Bagaimana cara memasang modul ini?")).toMatchObject({
      code: "id"
    })
  })

  it("detects English questions", () => {
    expect(detectQuestionLanguage("How should I wire the stop input?")).toMatchObject({
      code: "en"
    })
  })

  it("falls back safely for ambiguous input", () => {
    expect(detectQuestionLanguage("1756-L7SP wiring")).toMatchObject({
      code: "same_as_question"
    })
  })
})

describe("getRefusalSummaryForLanguage", () => {
  it("returns Indonesian refusal copy", () => {
    expect(getRefusalSummaryForLanguage({ code: "id", instruction: "Answer in Indonesian." })).toMatch(
      /Saya tidak menemukan bukti/
    )
  })
})
