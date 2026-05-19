# English Canonical Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize all assistant retrieval and output to English so citation selection is more stable across user question languages.

**Architecture:** Keep `convex/search.ts` as the orchestration boundary. Add a small English canonical query generator to the existing Inception structured-output module, replace dominant-language response policy with an English-only policy, and use the canonical English question for diagnostic parsing, vector search, exact fallback, and final answer generation while preserving the raw user message in chat history.

**Tech Stack:** Convex `^1.39.1`, TypeScript `^6.0.3`, Vitest `^4.1.6`, Bun, Jina embeddings, Inception structured chat completions.

**Execution Constraint:** Work directly in the current main workspace without creating a git worktree. Do not commit automatically; ask the user before any commit.

---

## Research Notes

- Jina AI docs list `jina-embeddings-v5-text-small` as a multilingual 1024-dimensional embedding model with `retrieval.query` and `retrieval.passage` tasks. Source: https://docs.jina.ai/
- Jina model docs state `jina-embeddings-v5-text-small` supports asymmetric retrieval with `Query:` and `Document:` prefixes, but this does not guarantee identical rankings for translated queries. Source: https://jina.ai/models/jina-embeddings-v5-text-small/
- Convex vector search docs state `ctx.vectorSearch` returns results in relevance order with `_score`; search quality depends on the query vector and `limit`. Source: https://docs.convex.dev/search/vector-search
- Existing project patterns use direct Vitest handler tests for Convex actions and internal queries, spies for provider helpers, and explicit `returns` validators on Convex functions.

## File Structure

- Modify `convex/lib/questionLanguage.ts` to expose an English-only response policy while keeping the existing `buildResponseLanguagePolicy()` API for minimal churn.
- Modify `convex/lib/questionLanguage.test.ts` to assert English-only behavior and removal of dominant-language behavior.
- Modify `convex/lib/inception.ts` to add a structured English canonical query generator.
- Modify `convex/lib/inception.test.ts` to cover the canonical query generator and update prompt assertions to English-only behavior.
- Modify `convex/search.ts` to generate and use the canonical English question across retrieval, diagnostic, exact fallback, refusal, clarification, and grounded-answer paths.
- Modify `convex/search.ask.test.ts` to mock canonicalization, assert raw chat preservation, and assert canonical English inputs are used downstream.
- Keep UI and schema files unchanged.

## Task 1: Replace Response Policy With English-Only Policy

**Files:**

- Modify: `convex/lib/questionLanguage.test.ts`
- Modify: `convex/lib/questionLanguage.ts`

- [ ] **Step 1: Write the failing question-language tests**

Replace the current tests in `convex/lib/questionLanguage.test.ts` with tests for the English-only policy:

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
    "Wie setze ich den Antrieb zurück?"
  ])("builds the same English-only policy for %s", (question) => {
    const policy = buildResponseLanguagePolicy(question)

    expect(policy).toEqual({
      instruction:
        "Answer every natural-language assistant response field in English, regardless of the user's question language, retrieved context language, manual language, or system instruction language. Preserve citation labels, fault codes, alarm codes, model numbers, product names, vendor names, commands, parameter names, units, and code when translation could change meaning. Do not translate technical identifiers."
    })
    expect(policy).not.toHaveProperty("code")
  })

  it("does not contain dominant-language instructions", () => {
    const policy = buildResponseLanguagePolicy("Bagaimana cara memasang modul ini?")

    expect(policy.instruction).toContain("English")
    expect(policy.instruction).not.toContain("dominant language")
    expect(policy.instruction).not.toContain("Preserve the user's script")
    expect(policy.instruction).not.toContain("do not answer in English")
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test convex/lib/questionLanguage.test.ts`

Expected: FAIL because `buildResponseLanguagePolicy()` still returns the dominant-language policy.

- [ ] **Step 3: Implement the English-only policy**

Update `convex/lib/questionLanguage.ts` to:

```ts
export type ResponseLanguagePolicy = {
  instruction: string
}

export const ENGLISH_ONLY_RESPONSE_INSTRUCTION =
  "Answer every natural-language assistant response field in English, regardless of the user's question language, retrieved context language, manual language, or system instruction language. Preserve citation labels, fault codes, alarm codes, model numbers, product names, vendor names, commands, parameter names, units, and code when translation could change meaning. Do not translate technical identifiers."

export function buildResponseLanguagePolicy(_question: string): ResponseLanguagePolicy {
  return { instruction: ENGLISH_ONLY_RESPONSE_INSTRUCTION }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test convex/lib/questionLanguage.test.ts`

Expected: PASS.

## Task 2: Add Structured English Canonical Query Generation

**Files:**

- Modify: `convex/lib/inception.test.ts`
- Modify: `convex/lib/inception.ts`

- [ ] **Step 1: Write failing canonical-query tests**

In `convex/lib/inception.test.ts`, update the import from `./inception` to include `generateEnglishQuestion` and rename the local policy constant to `englishOnlyPolicy`:

```ts
import {
  extractTextContent,
  generateClarifyingQuestion,
  generateEnglishQuestion,
  generateGroundedAnswer,
  generateInsufficientEvidenceSummary
} from "./inception"

const englishOnlyPolicy: ResponseLanguagePolicy = {
  instruction: buildResponseLanguagePolicy("¿Cómo reinicio el variador?").instruction
}
```

Add this describe block after `extractTextContent` tests:

```ts
describe("generateEnglishQuestion", () => {
  it("posts a strict structured request that canonicalizes a non-English question", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponse('{"englishQuestion":"How do I reset the drive fault F002 on a SINAMICS G120?"}')
    )

    await expect(
      withProviderEnv(() =>
        generateEnglishQuestion("Bagaimana reset fault F002 pada SINAMICS G120?", {
          fetchImpl
        })
      )
    ).resolves.toEqual({
      englishQuestion: "How do I reset the drive fault F002 on a SINAMICS G120?"
    })

    const request = getRequest(fetchImpl)
    expect(request.body.response_format).toEqual({
      json_schema: {
        name: "EnglishQuestion",
        schema: {
          additionalProperties: false,
          properties: {
            englishQuestion: { type: "string" }
          },
          required: ["englishQuestion"],
          type: "object"
        },
        strict: true
      },
      type: "json_schema"
    })
    expect(request.body.messages).toEqual([
      {
        content: expect.stringContaining("Rewrite the user's question as a concise English technical search query"),
        role: "system"
      },
      {
        content: "Question: Bagaimana reset fault F002 pada SINAMICS G120?",
        role: "user"
      }
    ])
    const systemPrompt = String((request.body.messages as Array<{ content: string }>)[0]?.content)
    expect(systemPrompt).toContain("Do not answer the question")
    expect(systemPrompt).toContain("Do not add facts")
    expect(systemPrompt).toContain("fault codes")
    expect(systemPrompt).toContain("model numbers")
    expect(systemPrompt).toContain("Return strict JSON with key englishQuestion")
  })

  it("returns provider token usage for canonicalization", async () => {
    const fetchImpl = vi.fn(async () =>
      createChatResponseWithUsage('{"englishQuestion":"How should I wire the stop input?"}', {
        completion_tokens: 12,
        prompt_tokens: 44
      })
    )

    await expect(
      generateEnglishQuestion("¿Cómo cableo la entrada de parada?", {
        apiKey: "key",
        fetchImpl
      })
    ).resolves.toEqual({
      englishQuestion: "How should I wire the stop input?",
      usage: {
        inputTokens: 44,
        outputTokens: 12
      }
    })
  })

  it("throws sanitized ProviderPermanentError for empty canonical questions", async () => {
    const fetchImpl = vi.fn(async () => createChatResponse('{"englishQuestion":"   "}'))

    const error = await captureError(
      generateEnglishQuestion("secret question", {
        apiKey: "sk-secret",
        fetchImpl
      })
    )

    expect(error).toBeInstanceOf(ProviderPermanentError)
    expectNoSecretLeak(error)
  })
})
```

Also update existing prompt assertions in this file from dominant-language expectations to English-only expectations:

```ts
expect(String((request.body.messages as Array<{ content: string }>)[0]?.content)).toContain(
  "Answer every natural-language assistant response field in English"
)
expect(String((request.body.messages as Array<{ content: string }>)[0]?.content)).toContain(
  "Do not translate technical identifiers"
)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test convex/lib/inception.test.ts`

Expected: FAIL because `generateEnglishQuestion` is not exported and prompts still assert dominant-language behavior.

- [ ] **Step 3: Implement English question parsing and schema**

In `convex/lib/inception.ts`, add this type near the other structured output types:

```ts
type EnglishQuestion = {
  englishQuestion: string
  usage?: ProviderTokenUsage
}
```

Add this schema near the other schemas:

```ts
const ENGLISH_QUESTION_SCHEMA = {
  additionalProperties: false,
  properties: { englishQuestion: { type: "string" } },
  required: ["englishQuestion"],
  type: "object"
} as const
```

Add this parser near the existing parse helpers:

```ts
function parseEnglishQuestion(content: unknown): EnglishQuestion {
  const jsonText = extractTextContent(content)
  if (!jsonText) {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ProviderPermanentError({ provider: INCEPTION_PROVIDER })
  }

  const englishQuestion = requiredTrimmedString((parsed as { englishQuestion?: unknown }).englishQuestion)

  return { englishQuestion }
}
```

- [ ] **Step 4: Export `generateEnglishQuestion`**

Add this export near `generateGroundedAnswer()`:

```ts
export async function generateEnglishQuestion(
  question: string,
  options: InceptionOptions = {}
): Promise<{ englishQuestion: string; usage?: ProviderTokenUsage }> {
  const completion = await requestStructuredCompletion({
    messages: [
      {
        content:
          "Rewrite the user's question as a concise English technical search query for official industrial equipment manuals. Preserve fault codes, alarm codes, model numbers, vendor names, product names, command names, parameter names, values, units, and citation labels exactly. Do not answer the question. Do not add facts, assumptions, causes, fixes, or product details that are not present in the user's question. Return strict JSON with key englishQuestion.",
        role: "system"
      },
      {
        content: `Question: ${question}`,
        role: "user"
      }
    ],
    options,
    schema: ENGLISH_QUESTION_SCHEMA,
    schemaName: "EnglishQuestion"
  })

  const englishQuestion = parseEnglishQuestion(completion.content)
  return completion.usage === undefined ? englishQuestion : { ...englishQuestion, usage: completion.usage }
}
```

- [ ] **Step 5: Update answer/refusal/clarification prompt assertions**

Ensure `generateGroundedAnswer()`, `generateInsufficientEvidenceSummary()`, and `generateClarifyingQuestion()` still include `language.instruction`; tests should now assert that the instruction is English-only. Do not add language detection back.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `bun test convex/lib/inception.test.ts`

Expected: PASS.

## Task 3: Integrate Canonical English Query In Search Orchestration

**Files:**

- Modify: `convex/search.ask.test.ts`
- Modify: `convex/search.ts`

- [ ] **Step 1: Write failing search orchestration tests**

In `convex/search.ask.test.ts`, update the import spies:

```ts
const generateEnglishQuestion = vi.spyOn(inceptionModule, "generateEnglishQuestion")
```

Update `beforeEach()`:

```ts
generateEnglishQuestion.mockReset()
generateEnglishQuestion.mockImplementation(async (question: string) => ({ englishQuestion: question }))
```

Rename `expectDominantLanguagePolicy()` to `expectEnglishOnlyPolicy()`:

```ts
function expectEnglishOnlyPolicy() {
  return expect.objectContaining({
    instruction: expect.stringContaining("Answer every natural-language assistant response field in English")
  })
}
```

Add a new test near the other grounded-answer tests:

```ts
it("uses canonical English for retrieval and answer generation while preserving the raw user message", async () => {
  generateEnglishQuestion.mockResolvedValueOnce({
    englishQuestion: "How should I install this module?"
  })

  const runQuery = vi
    .fn()
    .mockResolvedValueOnce({
      _id: "chatSessions_1" as never,
      createdAt: 1,
      title: "Bagaimana cara memasang modul ini?",
      updatedAt: 1
    })
    .mockResolvedValueOnce([
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 12",
        chunkId: "chunks_1" as never,
        content: "Install the module beside the controller.",
        pageNumber: 12,
        score: 0.97
      }
    ])

  const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1", "chatMessages_2", null])
  const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.97 }])

  await askHandler._handler(
    {
      runMutation,
      runQuery,
      vectorSearch
    } as never,
    {
      question: "Bagaimana cara memasang modul ini?",
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1" as never
    }
  )

  expect(generateEnglishQuestion).toHaveBeenCalledWith(
    "Bagaimana cara memasang modul ini?",
    expect.objectContaining({ keyId: "inception:1" })
  )
  expect(embedSearchQuery).toHaveBeenCalledWith("How should I install this module?", expect.any(Object))
  expect(generateGroundedAnswer).toHaveBeenCalledWith(
    "How should I install this module?",
    expect.any(String),
    expectEnglishOnlyPolicy(),
    expect.objectContaining({ keyId: "inception:1" })
  )
  expect(getMutationArgs(runMutation, "chats:appendMessage")[0]).toEqual({
    content: "Bagaimana cara memasang modul ini?",
    role: "user",
    sessionId: "chatSessions_1"
  })
})
```

Add a second test for exact fallback terms:

```ts
it("uses canonical English terms for exact fallback", async () => {
  generateEnglishQuestion.mockResolvedValueOnce({
    englishQuestion: "PowerFlex 755 fault F002 after first power on"
  })

  const runQuery = vi
    .fn()
    .mockResolvedValueOnce({
      _id: "chatSessions_1" as never,
      createdAt: 1,
      title: "F002 setelah power on pertama",
      updatedAt: 1
    })
    .mockResolvedValueOnce([
      {
        documentId: "documents_1" as never,
        language: "English",
        productSlug: "powerflex-755",
        title: "PowerFlex 755 Manual",
        vendorSlug: "rockwell-automation",
        version: "v1"
      }
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 214",
        chunkId: "chunks_f002" as never,
        content: "Fault F002 table for PowerFlex 755 first power on.",
        pageNumber: 214,
        score: 0.9
      }
    ])
    .mockResolvedValueOnce(exactPage([]))

  const runMutation = createRunMutation([{ allowed: true }, "chatMessages_1", "chatMessages_2", null])
  const vectorSearch = vi.fn().mockResolvedValue([])

  await askHandler._handler(
    {
      runMutation,
      runQuery,
      vectorSearch
    } as never,
    {
      question: "Rockwell PowerFlex 755 F002 setelah power on pertama",
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1" as never
    }
  )

  expect(runQuery).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      question: "PowerFlex 755 fault F002 after first power on",
      terms: expect.arrayContaining(["f002", "powerflex 755"])
    })
  )
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test convex/search.ask.test.ts`

Expected: FAIL because `generateEnglishQuestion` is not called by `ask()` yet and existing policy expectations still reference dominant language.

- [ ] **Step 3: Import `generateEnglishQuestion` and add canonicalization types**

In `convex/search.ts`, update the Inception import:

```ts
import {
  generateClarifyingQuestion,
  generateEnglishQuestion,
  generateGroundedAnswer,
  generateInsufficientEvidenceSummary
} from "./lib/inception"
```

Add this type near `GroundedAnswerGeneration`:

```ts
type EnglishQuestionGeneration = {
  englishQuestion: string
  usage?: ProviderTokenUsage
}
```

Add this estimator near the other estimators:

```ts
function estimateEnglishQuestionOutputTokens(generated: { englishQuestion: string }) {
  return estimateTokenCount(generated.englishQuestion)
}
```

- [ ] **Step 4: Add a transient-safe canonicalization helper**

Add this helper near `generateShortInceptionResponse()`:

```ts
async function generateEnglishQuestionOrFallback(
  ctx: Pick<ActionCtx, "runMutation">,
  providerEnv: ProviderEnv,
  inceptionKeyPool: ProviderKey[],
  effectiveQuestion: string
) {
  const estimatedInputTokens = estimateTokenCount(effectiveQuestion)
  const estimatedOutputTokens = getInceptionEstimatedOutputTokens(providerEnv)
  let inceptionKeyId: string

  try {
    inceptionKeyId = await reserveProviderKey(
      ctx,
      {
        estimatedInputTokens,
        estimatedOutputTokens,
        inputTpmLimit: providerEnv.inceptionInputTpmPerKey,
        keyIds: inceptionKeyPool.map((key) => key.id),
        maxConcurrent: providerEnv.inceptionMaxConcurrentPerKey,
        outputTpmLimit: providerEnv.inceptionOutputTpmPerKey,
        provider: INCEPTION_PROVIDER,
        rpmLimit: providerEnv.inceptionRpmPerKey
      },
      "Answer"
    )
  } catch {
    return effectiveQuestion
  }

  try {
    const generated = await generateEnglishQuestion(
      effectiveQuestion,
      buildInceptionGenerationOptions(providerEnv, inceptionKeyPool, inceptionKeyId)
    )
    const outputTokens = generated.usage?.outputTokens ?? estimateEnglishQuestionOutputTokens(generated)
    await recordProviderSuccess(ctx, INCEPTION_PROVIDER, inceptionKeyId, "Answer", {
      ...(generated.usage?.inputTokens === undefined ? {} : { inputTokens: generated.usage.inputTokens }),
      outputTokens,
      reservedInputTokens: estimatedInputTokens,
      reservedOutputTokens: estimatedOutputTokens
    })
    return generated.englishQuestion
  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      await ctx.runMutation(internal.providerRateLimits.recordProviderRateLimit, {
        keyId: error.keyId,
        provider: INCEPTION_PROVIDER,
        retryAfterMs: getProviderRetryAfterMs(error.retryAfterMs)
      })
      return effectiveQuestion
    }

    if (error instanceof ProviderTransientError) {
      await ctx.runMutation(internal.providerRateLimits.recordProviderTransientFailure, {
        keyId: error.keyId ?? inceptionKeyId,
        provider: INCEPTION_PROVIDER
      })
      return effectiveQuestion
    }

    return await handleProviderFailure(ctx, {
      error,
      label: "Answer",
      provider: INCEPTION_PROVIDER,
      reservedKeyId: inceptionKeyId
    })
  }
}
```

- [ ] **Step 5: Use `englishQuestion` across retrieval and answer generation**

In `ask()` after the user message is appended and before diagnostic parsing, build provider pools and canonicalize:

```ts
const providerEnv = setupProviderKeyPool("Answer", () => getProviderEnv())
const inceptionKeyPool = setupProviderKeyPool("Answer", () =>
  buildProviderKeyPool(INCEPTION_PROVIDER, providerEnv.inceptionApiKeys)
)
const englishQuestion = await generateEnglishQuestionOrFallback(ctx, providerEnv, inceptionKeyPool, effectiveQuestion)
const responseLanguage = buildResponseLanguagePolicy(englishQuestion)
```

Then replace retrieval/answer usages:

```ts
if (!args.documentId && hasDiagnosticSignals(englishQuestion)) {
  const readyScopes = (await ctx.runQuery(internal.search.loadReadyDocumentScopes, {})) as DiagnosticDocumentScope[]
  diagnosticContext = understandDiagnosticQuery(englishQuestion, readyScopes)
  // existing scope and clarification flow
}

// embedSearchQuery(englishQuestion, ...)
// isLookupLikeQuery(englishQuestion)
// extractExactSearchTerms(englishQuestion)
// loadExactResults exactContent: englishQuestion
// loadGlobalExactResultsByTerms question: englishQuestion
// rankExactSearchResults(englishQuestion, candidates)
// generateInsufficientEvidenceSummary(englishQuestion, responseLanguage, options)
// generateGroundedAnswer(englishQuestion, context, responseLanguage, options)
```

Remove duplicate later setup of `providerEnv` and `inceptionKeyPool` so answer generation reuses the same values. Keep `jinaKeyPool` setup for embedding:

```ts
const jinaKeyPool = setupProviderKeyPool("Embedding", () =>
  buildProviderKeyPool(JINA_EMBEDDING_PROVIDER, providerEnv.jinaApiKeys)
)
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `bun test convex/search.ask.test.ts`

Expected: PASS after updating existing expectations from dominant-language policy to English-only policy and accounting for the canonicalization provider call.

## Task 4: Clean Up Multilingual Assumptions And Verify The Slice

**Files:**

- Modify: `convex/lib/inception.test.ts`
- Modify: `convex/search.ask.test.ts`
- Modify: any tests that still assert dominant-language output.

- [ ] **Step 1: Search for stale dominant-language expectations**

Run: use Grep for `dominant language|Do not default to English|do not answer in English|Preserve the user's script|expectDominantLanguagePolicy` under `convex`.

Expected: Matches may remain only in old design docs or specs, not in active tests or implementation prompts for current behavior.

- [ ] **Step 2: Replace stale active-test expectations**

For active test files, replace dominant-language assertions with English-only assertions:

```ts
expectEnglishOnlyPolicy()
expect(systemPrompt).toContain("Answer every natural-language assistant response field in English")
expect(systemPrompt).toContain("Do not translate technical identifiers")
```

For generated mock responses in English-only tests, use English responses such as:

```ts
generateInsufficientEvidenceSummary.mockResolvedValueOnce({
  answerSummary: "I could not find enough official evidence to answer safely."
})

generateClarifyingQuestion.mockResolvedValueOnce({
  clarifyingQuestion: "Which vendor and model are you working with?"
})
```

- [ ] **Step 3: Run all relevant tests**

Run: `bun test convex/lib/questionLanguage.test.ts convex/lib/inception.test.ts convex/search.ask.test.ts`

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `bun test`

Expected: PASS.

- [ ] **Step 5: Run mandatory lint**

Run: `bun run lint`

Expected: PASS with zero type or lint errors.

If Biome formats files, inspect the changes and keep only intended changes.

## Final Review Checklist

- [ ] `convex/lib/questionLanguage.ts` no longer instructs dominant-language responses.
- [ ] `convex/lib/inception.ts` exports `generateEnglishQuestion()` with strict JSON parsing.
- [ ] `convex/search.ts` preserves the raw user question in chat history.
- [ ] `convex/search.ts` uses the English canonical question for diagnostic, vector retrieval, exact fallback, refusal, and grounded answer paths.
- [ ] Transient canonicalization failure falls back to `effectiveQuestion`.
- [ ] Permanent provider configuration errors remain surfaced through existing provider error handling.
- [ ] Tests prove non-English questions use English canonical retrieval.
- [ ] `bun run lint` passes.
- [ ] No commits were created automatically.
