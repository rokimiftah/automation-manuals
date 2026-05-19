import { describe, expect, it } from "vitest"

import { buildResponseLanguagePolicy } from "./questionLanguage"

describe("buildResponseLanguagePolicy", () => {
  it.each([
    "كيف أصلح هذا الخطأ؟",
    "¿Cómo reinicio el variador?",
    "このエラーを解除する方法は？",
    "How should I wire the stop input?",
    "Bagaimana cara memasang modul ini?",
    "Wie setze ich den Antrieb zurück?"
  ])("builds the same English-only policy for %s", (question) => {
    const policy = buildResponseLanguagePolicy(question)

    expect(policy).toEqual({
      instruction:
        "Answer every natural-language assistant response field in English, regardless of the user's question language, retrieved context language, manual language, or system instruction language. Preserve citation labels, fault codes, alarm codes, model numbers, product names, vendor names, commands, parameter names, units, and code when translation could change meaning. Do not translate technical identifiers."
    })
    expect(policy).not.toHaveProperty("code")
  })

  it("contains English-only response constraints", () => {
    const policy = buildResponseLanguagePolicy("Bagaimana cara memasang modul ini?")

    expect(policy.instruction).toContain("Answer every natural-language assistant response field in English")
    expect(policy.instruction).toContain("Do not translate technical identifiers")
  })
})
