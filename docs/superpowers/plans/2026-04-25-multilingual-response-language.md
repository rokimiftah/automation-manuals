# Multilingual Response Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grounded answers and refusal answers follow the user's question language without changing retrieval behavior.

**Architecture:** Keep retrieval orchestration in `convex/search.ts`. Add one pure language helper, thread its result into `generateGroundedAnswer(...)`, and localize the refusal summary in `buildRefusalPacket(...)`. Cover the change with deterministic unit tests and search-flow tests.

**Tech Stack:** Convex, TypeScript, Vitest, Bun, Mistral TypeScript SDK.

---

## File Structure

- Create `convex/lib/questionLanguage.ts` for pure question-language detection and refusal-copy helpers.
- Create `convex/lib/questionLanguage.test.ts` for deterministic unit tests of language detection and refusal text.
- Modify `convex/lib/mistral.ts` to accept a response-language descriptor and include it in the Mistral prompt.
- Modify `convex/lib/mistral.test.ts` to assert the prompt contains the language requirement.
- Modify `convex/lib/answerPacket.ts` so refusal packets are localized without changing packet shape.
- Modify `convex/search.ts` to infer the response language once and pass it through grounded and refusal flows.
- Modify `convex/search.ask.test.ts` to cover Indonesian grounded/refusal behavior.

## Task 1: Add a pure question-language helper

**Files:**

- Create: `convex/lib/questionLanguage.ts`
- Create: `convex/lib/questionLanguage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run the helper test to confirm it fails**

Run: `bun test convex/lib/questionLanguage.test.ts`

Expected: FAIL because `convex/lib/questionLanguage.ts` does not exist yet.

- [ ] **Step 3: Write the minimal helper implementation**

```ts
export type QuestionLanguage = {
  code: "en" | "id" | "same_as_question"
  instruction: string
}

const INDONESIAN_MARKERS = ["bagaimana", "apakah", "dengan", "untuk", "yang", "dan", "atau", "bisa", "cara"]

function tokenize(question: string) {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function detectQuestionLanguage(question: string): QuestionLanguage {
  const tokens = tokenize(question)
  const indonesianHits = tokens.filter((token) => INDONESIAN_MARKERS.includes(token)).length

  if (indonesianHits >= 1) {
    return { code: "id", instruction: "Answer in Indonesian." }
  }

  if (/\b(how|what|where|when|why|should|can|please|show)\b/i.test(question)) {
    return { code: "en", instruction: "Answer in English." }
  }

  return {
    code: "same_as_question",
    instruction: "Answer in the same language as the user's question."
  }
}

export function getRefusalSummaryForLanguage(language: QuestionLanguage) {
  if (language.code === "id") {
    return "Saya tidak menemukan bukti yang cukup di dokumentasi resmi untuk menjawabnya dengan aman."
  }

  return "I could not find enough evidence in the official documentation to answer that safely."
}
```

- [ ] **Step 4: Re-run the helper test and confirm it passes**

Run: `bun test convex/lib/questionLanguage.test.ts`

Expected: PASS.

## Task 2: Thread response language into answer generation

**Files:**

- Modify: `convex/lib/mistral.ts`
- Modify: `convex/lib/mistral.test.ts`

- [ ] **Step 1: Write the failing prompt-contract test**

```ts
it("includes the response language requirement in the grounded-answer prompt", async () => {
  const client = {
    chat: {
      complete: vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"answerSummary":"Ringkas","answerSteps":["Langkah"],"citationIds":["E1"]}' } }]
      })
    }
  }

  await generateGroundedAnswer(
    "Bagaimana cara memasang modul ini?",
    "Pasang modul di samping kontroler.",
    { code: "id", instruction: "Answer in Indonesian." },
    { client, model: "mistral-small-latest" }
  )

  expect(client.chat.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      messages: [
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Answer in Indonesian.")
        }),
        expect.anything()
      ]
    })
  )
})
```

- [ ] **Step 2: Run the Mistral test slice to confirm it fails**

Run: `bun test convex/lib/mistral.test.ts`

Expected: FAIL because `generateGroundedAnswer(...)` does not accept the new language argument yet.

- [ ] **Step 3: Implement the minimal prompt update**

```ts
type QuestionLanguage = {
  code: "en" | "id" | "same_as_question"
  instruction: string
}

export async function generateGroundedAnswer(
  question: string,
  context: string,
  language: QuestionLanguage,
  options: ProviderOptions = {}
) {
  const client = (options.client ?? getMistralClient()) as MistralClientLike
  const model = options.model ?? getProviderEnv().mistralChatModel
  const response = await client.chat.complete({
    messages: [
      {
        content: `Use only the provided context. ${language.instruction} Preserve technical identifiers, code, commands, and citation labels when translating them could change meaning. If the context is insufficient, say so and return an empty answerSteps array and an empty citationIds array. Return strict JSON with keys answerSummary, answerSteps, and citationIds.`,
        role: "system"
      },
      {
        content: `Question: ${question}\n\nContext: ${context}`,
        role: "user"
      }
    ],
    model,
    responseFormat: { type: "json_object" }
  })

  // existing JSON parsing stays the same
}
```

- [ ] **Step 4: Re-run the Mistral test slice and confirm it passes**

Run: `bun test convex/lib/mistral.test.ts`

Expected: PASS.

## Task 3: Localize refusal packets and wire the search flow

**Files:**

- Modify: `convex/lib/answerPacket.ts`
- Modify: `convex/search.ts`
- Modify: `convex/search.ask.test.ts`

- [ ] **Step 1: Write the failing search-flow tests**

```ts
it("passes Indonesian response-language instructions into grounded answer generation", async () => {
  await askHandler._handler({ runMutation, runQuery, vectorSearch } as never, {
    question: "Bagaimana cara memasang modul ini?",
    sessionAccessToken: "access-token-1",
    sessionId: "chatSessions_1" as never
  })

  expect(generateGroundedAnswer).toHaveBeenCalledWith(
    "Bagaimana cara memasang modul ini?",
    expect.any(String),
    expect.objectContaining({ code: "id" })
  )
})

it("returns an Indonesian refusal summary when evidence is insufficient", async () => {
  generateGroundedAnswer.mockResolvedValue({
    answerSteps: [],
    answerSummary: "Konteks tidak cukup.",
    citationIds: []
  })

  const packet = await askHandler._handler({ runMutation, runQuery, vectorSearch } as never, {
    question: "Bagaimana cara memasang modul ini?",
    sessionAccessToken: "access-token-1",
    sessionId: "chatSessions_1" as never
  })

  expect(packet.answerabilityStatus).toBe("insufficient_evidence")
  expect(packet.answerSummary).toMatch(/Saya tidak menemukan bukti/)
})
```

- [ ] **Step 2: Run the search-flow test slice to confirm it fails**

Run: `bun test convex/search.ask.test.ts`

Expected: FAIL because `search.ask` and `buildRefusalPacket(...)` do not pass localized language state yet.

- [ ] **Step 3: Implement the minimal search-flow wiring**

```ts
const responseLanguage = detectQuestionLanguage(question)

const groundedAnswer = await generateGroundedAnswer(question, context, responseLanguage)

const packet =
  groundedAnswer.answerSummary.length === 0 || groundedAnswer.answerSteps.length === 0 || selectedEvidence.length === 0
    ? buildRefusalPacket(sessionId, sessionAccessToken, responseLanguage)
    : buildGroundedPacket(
        sessionId,
        sessionAccessToken,
        groundedAnswer.answerSummary,
        groundedAnswer.answerSteps,
        selectedEvidence
      )
```

- [ ] **Step 4: Re-run the search-flow tests and confirm they pass**

Run: `bun test convex/search.ask.test.ts`

Expected: PASS.

## Task 4: Full verification

**Files:**

- Modify: no new files expected beyond the files above

- [ ] **Step 1: Run the targeted test files together**

Run: `bun test convex/lib/questionLanguage.test.ts convex/lib/mistral.test.ts convex/search.ask.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the required repo verification**

Run: `bun run lint`

Expected: PASS with no Biome or TypeScript errors.
