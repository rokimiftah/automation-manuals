import { describe, expect, it } from "vitest"

import { buildResponseLanguagePolicy } from "./questionLanguage"

describe("buildResponseLanguagePolicy", () => {
  it.each([
    "كيف أصلح هذا الخطأ؟",
    "¿Cómo reinicio el variador?",
    "このエラーを解除する方法は？",
    "How should I wire the stop input?",
    "Bagaimana cara memasang modul ini?",
    "How to reset fault pada PLC ini?"
  ])("builds the same dominant-language policy for %s", (question) => {
    const policy = buildResponseLanguagePolicy(question)

    expect(policy).toEqual({
      instruction:
        "Determine the response language from the user's question only, not from retrieved context, manual language, or the language of these system instructions. Answer every natural-language response field in the dominant language of the user's question. If the question mixes languages, use the dominant language. If retrieved context is in a different language, translate the answer into the target response language. Preserve the user's script. Do not default to English unless English is the dominant language of the user's question. If the user's question is not English, do not answer in English. Before returning JSON, verify that answerSummary, answerSteps, and clarifyingQuestion use the target response language. Do not translate citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, or code when translation could change meaning."
    })
    expect(policy).not.toHaveProperty("code")
  })

  it("forbids English fallback for non-English questions", () => {
    const policy = buildResponseLanguagePolicy("¿Cómo reinicio el variador?")

    expect(policy.instruction).toContain("If the user's question is not English, do not answer in English")
    expect(policy.instruction).toContain("Before returning JSON, verify")
  })
})
