# Multilingual Assistant Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all assistant-generated output use the dominant language of the user's question while removing hardcoded `id` and `en` language routing from assistant response behavior.

**Architecture:** Replace enum-based language detection with a provider-facing `ResponseLanguagePolicy`. Reuse the existing Inception/Mercury structured-output client for grounded answers, no-evidence refusals, and diagnostic clarifications. Keep UI labels and admin/platform copy unchanged.

**Tech Stack:** Convex `1.39.1`, Inception Mercury 2 chat completions with JSON schema structured outputs, Vitest `4.1.6`, TypeScript `6.0.3`, Bun.

**Execution Constraints:** Work directly on the current `main` branch as requested. Do not create a git worktree. Do not commit unless the user explicitly grants commit permission.

---

## Research Notes

- Convex project pin: `convex@1.39.1` from `package.json`. Official docs confirm `query`, `mutation`, and `action` should use runtime `args` and `returns` validators; object return validators reject undeclared fields. Sources: https://docs.convex.dev/functions/validation and https://docs.convex.dev/using/actions
- Convex actions can call external APIs and interact with the database only through `ctx.runQuery` and `ctx.runMutation`; actions can use `fetch` in the Convex runtime. Source: https://docs.convex.dev/using/actions
- Inception Mercury 2 supports `v1/chat/completions`, `response_format: { type: "json_schema", json_schema: ... }`, and model `mercury-2` with structured outputs. Sources: https://docs.inceptionlabs.ai/capabilities/structured-outputs, https://docs.inceptionlabs.ai/capabilities/chat-completions, https://docs.inceptionlabs.ai/get-started/models
- Vitest project pin: `vitest@4.1.6`. Release comparison from May 11, 2026 shows no breaking change for existing `vi.fn`/mock patterns; `test.sequential` is deprecated in favor of `concurrent: false`, which this plan does not use. Source: https://github.com/vitest-dev/vitest/compare/v4.1.5...v4.1.6

## Files

- Modify: `convex/lib/questionLanguage.ts` to replace `QuestionLanguage` with `ResponseLanguagePolicy` and remove `id/en/same_as_question` codes.
- Modify: `convex/lib/questionLanguage.test.ts` to cover the language policy with Arabic, Spanish, Japanese, English, Indonesian, and mixed-language questions.
- Modify: `convex/lib/inception.ts` to accept `ResponseLanguagePolicy`, improve grounded prompt wording, and add structured helpers for refusal and clarification.
- Modify: `convex/lib/inception.test.ts` to remove `Answer in English.` and `Answer in Indonesian.` assumptions and cover new structured helper calls.
- Modify: `convex/lib/answerPacket.ts` to remove English default refusal text and accept generated refusal summaries.
- Modify: `convex/lib/answerPacket.test.ts` to assert generated refusal summaries are used as-is.
- Modify: `convex/lib/diagnosticQuery.ts` to remove language-code-dependent clarification copy and expose prompt input for clarification generation.
- Modify: `convex/lib/diagnosticQuery.test.ts` to remove `id/en` API usage and assert missing-context prompt input is language-neutral.
- Modify: `convex/search.ts` to build response language policy once, pass it to grounded/refusal/clarification generation, and account for Inception provider usage in the new short-generation paths.
- Modify: `convex/search.ask.test.ts` to assert policy propagation instead of language codes and cover non-Latin scripts.

## Task 1: Replace Language Code Detector With Policy Helper

**Files:**

- Modify: `convex/lib/questionLanguage.ts`
- Modify: `convex/lib/questionLanguage.test.ts`

- [ ] **Step 1: Write failing tests for policy shape**

Replace `convex/lib/questionLanguage.test.ts` with:

```ts
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
        "Determine the response language from the user's question only, not from retrieved context or manual language. Answer every natural-language response field in the dominant language of the user's question. If the question mixes languages, use the dominant language. If retrieved context is in a different language, translate the answer into the target response language. Preserve the user's script. Do not default to English unless English is the dominant language of the user's question. Do not translate citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, or code when translation could change meaning."
    })
    expect(policy).not.toHaveProperty("code")
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test convex/lib/questionLanguage.test.ts`

Expected: FAIL because `buildResponseLanguagePolicy` is not exported.

- [ ] **Step 3: Implement the minimal policy helper**

Replace `convex/lib/questionLanguage.ts` with:

```ts
export type ResponseLanguagePolicy = {
  instruction: string
}

export const DOMINANT_LANGUAGE_RESPONSE_INSTRUCTION =
  "Determine the response language from the user's question only, not from retrieved context or manual language. Answer every natural-language response field in the dominant language of the user's question. If the question mixes languages, use the dominant language. If retrieved context is in a different language, translate the answer into the target response language. Preserve the user's script. Do not default to English unless English is the dominant language of the user's question. Do not translate citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, or code when translation could change meaning."

export function buildResponseLanguagePolicy(_question: string): ResponseLanguagePolicy {
  return { instruction: DOMINANT_LANGUAGE_RESPONSE_INSTRUCTION }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `bun test convex/lib/questionLanguage.test.ts`

Expected: PASS.

## Task 2: Add Inception Structured Helpers For Multilingual Meta Responses

**Files:**

- Modify: `convex/lib/inception.ts`
- Modify: `convex/lib/inception.test.ts`

- [ ] **Step 1: Write failing tests for prompt policy and helpers**

In `convex/lib/inception.test.ts`, update imports from `questionLanguage` types to `ResponseLanguagePolicy`. Add this shared policy in the test file:

```ts
const dominantLanguagePolicy: ResponseLanguagePolicy = {
  instruction:
    "Determine the response language from the user's question only, not from retrieved context or manual language. Answer every natural-language response field in the dominant language of the user's question. If the question mixes languages, use the dominant language. If retrieved context is in a different language, translate the answer into the target response language. Preserve the user's script. Do not default to English unless English is the dominant language of the user's question. Do not translate citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, or code when translation could change meaning."
}
```

Replace existing `{ code: "en", instruction: "Answer in English." }` and `{ code: "id", instruction: "Answer in Indonesian." }` arguments with `dominantLanguagePolicy`.

Add tests:

```ts
it("passes dominant-language policy into grounded answer generation", async () => {
  const fetchImpl = vi.fn(async () =>
    jsonResponse({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ answerSummary: "回答", answerSteps: ["手順"], citationIds: ["E1"] }) }
        }
      ]
    })
  )

  await generateGroundedAnswer("このエラーを解除する方法は？", "[E1] Page 1: Reset the drive.", dominantLanguagePolicy, {
    fetchImpl
  })

  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
  expect(body.messages[0].content).toContain("Determine the response language from the user's question only")
  expect(body.messages[0].content).toContain("Preserve the user's script")
})

it("generates a structured refusal summary with the language policy", async () => {
  const fetchImpl = vi.fn(async () =>
    jsonResponse({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify({ answerSummary: "No hay evidencia suficiente." }) } }
      ]
    })
  )

  const result = await generateInsufficientEvidenceSummary("¿Cómo reinicio el variador?", dominantLanguagePolicy, { fetchImpl })

  expect(result.answerSummary).toBe("No hay evidencia suficiente.")
  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
  expect(body.response_format.json_schema.name).toBe("InsufficientEvidenceSummary")
  expect(body.messages[0].content).toContain("Determine the response language from the user's question only")
})

it("generates a structured clarification question with the language policy", async () => {
  const fetchImpl = vi.fn(async () =>
    jsonResponse({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify({ clarifyingQuestion: "ما الشركة المصنعة والطراز؟" }) } }
      ]
    })
  )

  const result = await generateClarifyingQuestion(
    {
      interpretedProblem: "كيف أصلح F002؟",
      missingContext: ["vendor", "model"]
    },
    dominantLanguagePolicy,
    { fetchImpl }
  )

  expect(result.clarifyingQuestion).toBe("ما الشركة المصنعة والطراز؟")
  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
  expect(body.response_format.json_schema.name).toBe("ClarifyingQuestion")
  expect(body.messages[0].content).toContain("Determine the response language from the user's question only")
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `bun test convex/lib/inception.test.ts`

Expected: FAIL because `generateInsufficientEvidenceSummary`, `generateClarifyingQuestion`, and `ResponseLanguagePolicy` usage are not implemented.

- [ ] **Step 3: Implement structured schemas and helper functions**

In `convex/lib/inception.ts`:

- Change `import type { QuestionLanguage } from "./questionLanguage"` to `import type { ResponseLanguagePolicy } from "./questionLanguage"`.
- Change the `generateGroundedAnswer` third parameter type to `ResponseLanguagePolicy`.
- Update the grounded system prompt to include `language.instruction` unchanged.
- Add schemas:

```ts
const INSUFFICIENT_EVIDENCE_SCHEMA = {
  additionalProperties: false,
  properties: { answerSummary: { type: "string" } },
  required: ["answerSummary"],
  type: "object"
} as const

const CLARIFYING_QUESTION_SCHEMA = {
  additionalProperties: false,
  properties: { clarifyingQuestion: { type: "string" } },
  required: ["clarifyingQuestion"],
  type: "object"
} as const
```

- Add parsing helpers using the same JSON parsing style as `parseGroundedAnswer`.
- Add exported helpers:

```ts
export async function generateInsufficientEvidenceSummary(
  question: string,
  language: ResponseLanguagePolicy,
  options: InceptionOptions = {}
): Promise<{ answerSummary: string; usage?: ProviderTokenUsage }> {
  // Use chat completions with json_schema name "InsufficientEvidenceSummary".
  // System message: use language.instruction and state that official documentation evidence is insufficient.
  // User message: `Question: ${question}`.
}

export async function generateClarifyingQuestion(
  input: { interpretedProblem: string; missingContext: string[] },
  language: ResponseLanguagePolicy,
  options: InceptionOptions = {}
): Promise<{ clarifyingQuestion: string; usage?: ProviderTokenUsage }> {
  // Use chat completions with json_schema name "ClarifyingQuestion".
  // System message: use language.instruction and ask only for missing context.
  // User message includes interpretedProblem and missingContext.
}
```

Implement these helpers by extracting a small shared `requestStructuredCompletion` helper if that keeps duplication lower without changing external behavior.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `bun test convex/lib/inception.test.ts`

Expected: PASS.

## Task 3: Remove Language-Specific Refusal And Clarification Builders

**Files:**

- Modify: `convex/lib/answerPacket.ts`
- Modify: `convex/lib/answerPacket.test.ts`
- Modify: `convex/lib/diagnosticQuery.ts`
- Modify: `convex/lib/diagnosticQuery.test.ts`

- [ ] **Step 1: Write failing answer packet tests**

In `convex/lib/answerPacket.test.ts`, replace refusal language-template assertions with:

```ts
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
```

- [ ] **Step 2: Write failing diagnostic query tests**

In `convex/lib/diagnosticQuery.test.ts`, remove tests that call `buildClarifyingQuestion(result, "id")` or `buildClarifyingQuestion(result, "en")`.

Add:

```ts
it("builds language-neutral clarification prompt input", () => {
  const result = understandDiagnosticQuery("F002 after first power on", scopes)

  expect(buildClarificationPromptInput(result)).toEqual({
    interpretedProblem: "F002 after first power on",
    missingContext: ["vendor", "model"]
  })
})
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `bun test convex/lib/answerPacket.test.ts convex/lib/diagnosticQuery.test.ts`

Expected: FAIL because `buildRefusalPacket` still expects a language object and `buildClarificationPromptInput` is not exported.

- [ ] **Step 4: Implement minimal helpers**

In `convex/lib/answerPacket.ts`:

- Remove `QuestionLanguage` and `getRefusalSummaryForLanguage` imports.
- Change `buildRefusalPacket` signature to:

```ts
export function buildRefusalPacket(
  sessionId: GenericId<"chatSessions">,
  sessionAccessToken: string,
  answerSummary: string,
  answerSteps: string[] = []
): AnswerPacket
```

- Set `answerSummary` directly from the argument.

In `convex/lib/diagnosticQuery.ts`:

- Remove `buildClarifyingQuestion` and its language-code branches.
- Add:

```ts
export type ClarificationPromptInput = {
  interpretedProblem: string
  missingContext: MissingDiagnosticContext[]
}

export function buildClarificationPromptInput(context: DiagnosticQueryUnderstanding): ClarificationPromptInput {
  return {
    interpretedProblem: context.interpretedProblem,
    missingContext: context.missingContext
  }
}
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `bun test convex/lib/answerPacket.test.ts convex/lib/diagnosticQuery.test.ts`

Expected: PASS.

## Task 4: Integrate Policy And Meta-Response Generation In Search

**Files:**

- Modify: `convex/search.ts`
- Modify: `convex/search.ask.test.ts`

- [ ] **Step 1: Write failing search tests**

In `convex/search.ask.test.ts`:

- Replace `detectQuestionLanguage` mock/import expectations with `buildResponseLanguagePolicy` behavior.
- Replace assertions like `expect.objectContaining({ code: "en" })` and `expect.objectContaining({ code: "id" })` with:

```ts
expect.objectContaining({
  instruction: expect.stringContaining("dominant language of the user's question")
})
```

- Add a non-Latin grounded case that asks Japanese or Arabic and asserts `generateGroundedAnswer` receives the policy.
- Add a no-evidence case that mocks `generateInsufficientEvidenceSummary` returning a Spanish or Japanese summary and asserts the returned packet uses that summary.
- Add a needs-clarification case that mocks `generateClarifyingQuestion` returning an Arabic clarification and asserts `answerSummary` and `clarifyingQuestion` match it.

- [ ] **Step 2: Run focused search tests and verify they fail**

Run: `bun test convex/search.ask.test.ts`

Expected: FAIL because `search.ts` still calls `detectQuestionLanguage`, local clarification builder, and local refusal summary.

- [ ] **Step 3: Implement search integration**

In `convex/search.ts`:

- Change import to:

```ts
import { buildResponseLanguagePolicy } from "./lib/questionLanguage"
```

- Change diagnostic import to use `buildClarificationPromptInput` instead of `buildClarifyingQuestion`.
- Change Inception import to include:

```ts
;(generateClarifyingQuestion, generateInsufficientEvidenceSummary)
```

- Replace:

```ts
const responseLanguage = detectQuestionLanguage(effectiveQuestion)
```

with:

```ts
const responseLanguage = buildResponseLanguagePolicy(effectiveQuestion)
```

- In the `needsClarification` branch, reserve an Inception key, call `generateClarifyingQuestion(buildClarificationPromptInput(diagnosticContext), responseLanguage, options)`, record provider success, then build the clarification packet with the generated question.
- In the `mergedEvidence.length === 0` branch, reserve an Inception key, call `generateInsufficientEvidenceSummary(effectiveQuestion, responseLanguage, options)`, record provider success, then call `buildRefusalPacket(sessionId, sessionAccessToken, generated.answerSummary)`.
- In the grounded fallback after `generateGroundedAnswer`, change `buildRefusalPacket(sessionId, sessionAccessToken, responseLanguage)` to generate or reuse an insufficient-evidence summary. Keep it minimal by using `generateInsufficientEvidenceSummary` once when the grounded answer has no steps or selected evidence.
- Use existing `reserveProviderKey`, `recordProviderSuccess`, and `handleProviderFailure` helpers so provider rate accounting stays consistent.

- [ ] **Step 4: Run focused search tests and verify they pass**

Run: `bun test convex/search.ask.test.ts`

Expected: PASS.

## Task 5: Cleanup Hardcoded Assistant Language References And Verify

**Files:**

- Modify any remaining Convex test/code files that import `QuestionLanguage`, call `detectQuestionLanguage`, or assert `Answer in English.` / `Answer in Indonesian.`.

- [ ] **Step 1: Search for old assistant language routing**

Run: `rg 'QuestionLanguage|detectQuestionLanguage|getRefusalSummaryForLanguage|Answer in English|Answer in Indonesian|code: "en"|code: "id"|same_as_question|buildClarifyingQuestion' convex src`

Expected: No matches in production code. Test matches are allowed only if they assert absence or migration behavior; prefer no matches at all except documentation/specs.

- [ ] **Step 2: Fix any remaining old references**

Use these exact replacements for any remaining matches:

- `QuestionLanguage` -> `ResponseLanguagePolicy`
- `detectQuestionLanguage(effectiveQuestion)` -> `buildResponseLanguagePolicy(effectiveQuestion)`
- `getRefusalSummaryForLanguage(...)` -> generated summary from `generateInsufficientEvidenceSummary(...)`
- `buildClarifyingQuestion(context, ...)` -> generated question from `generateClarifyingQuestion(buildClarificationPromptInput(context), ...)`
- `{ code: "en", instruction: "Answer in English." }` -> `dominantLanguagePolicy` in tests
- `{ code: "id", instruction: "Answer in Indonesian." }` -> `dominantLanguagePolicy` in tests

- [ ] **Step 3: Run all tests**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 4: Run mandatory lint/typecheck**

Run: `bun run lint`

Expected: PASS. Note this command is mutating by design because it includes `biome check --write --unsafe .`.

- [ ] **Step 5: Inspect final status**

Run: `git status --short`

Expected: Only intended files modified or added. Do not commit unless the user grants permission.
