# English Canonical Search Design

## Goal

Make retrieval and assistant output stable across user question languages by normalizing every user question into an English technical search query and returning all assistant-generated output in English.

The product can still accept questions in any language. The backend should preserve the original user question in chat history, but search, answer generation, clarification prompts, and insufficient-evidence messages should use English as the canonical assistant language.

## Problem

The current search flow supports multilingual assistant output, but retrieval still uses the user's original question text. A semantically identical question in Indonesian, English, German, or Spanish produces different query embeddings, different exact-search terms, and different evidence ordering. Because the answer model selects `citationIds` from that evidence context, the final PDF citations can differ by question language.

Observed behavior for the same question in different languages includes citation differences such as:

- Indonesian: `16, 2, 12, 9`
- English: `9, 12, 16, 19`
- German: `9, 12, 16, 2`
- Spanish: `9, 16`

This is expected with the current architecture because multilingual embeddings improve cross-language retrieval but do not guarantee identical nearest-neighbor ordering for translated questions.

## Current Flow

- `convex/search.ts` builds `effectiveQuestion` from the user's current question and any previous interpreted problem.
- `buildResponseLanguagePolicy(effectiveQuestion)` instructs answer generation to use the dominant language of the user question.
- `embedSearchQuery(effectiveQuestion)` embeds the original-language question.
- `ctx.vectorSearch()` returns top vector matches for that original-language embedding.
- Exact fallback extracts exact terms from `effectiveQuestion`.
- Merged evidence is assigned temporary IDs such as `E1`, `E2`, and `E3`.
- `generateGroundedAnswer(effectiveQuestion, context, responseLanguage, options)` asks the answer model to choose `citationIds`.
- `selectEvidenceByCitationIds()` maps selected IDs back to evidence and the UI opens the selected PDF pages.

## Research Notes

- Project dependencies are pinned through `package.json`: Convex `^1.39.1`, Astro `^6.3.3`, React `^19.2.6`, TypeScript `^6.0.3`, and Vitest `^4.1.6`.
- Jina AI docs list `jina-embeddings-v5-text-small` as a 1024-dimensional multilingual embedding model with `retrieval.query` and `retrieval.passage` tasks. Source: https://docs.jina.ai/
- Jina model docs state `jina-embeddings-v5-text-small` supports asymmetric retrieval with `Query:` and `Document:` prefixes and is multilingual, but this does not promise identical rankings for translated queries. Source: https://jina.ai/models/jina-embeddings-v5-text-small/
- Convex vector search docs state `ctx.vectorSearch` returns results in relevance order with `_score`, and vector searches are limited by `limit` and vector-index filters. Source: https://docs.convex.dev/search/vector-search
- Relevant project implementation files are `convex/search.ts`, `convex/lib/inception.ts`, `convex/lib/questionLanguage.ts`, `convex/lib/exactTerms.ts`, `convex/lib/hybridRetrieval.ts`, and `convex/lib/answerPacket.ts`.

## Decision

Implement English Canonical Mode.

All user questions should be converted to an English technical query before retrieval. All natural-language assistant output should be English, including grounded answers, clarification questions, and insufficient-evidence responses.

The original user question remains stored exactly as entered. Technical identifiers must be preserved, not translated.

## In Scope

- Add an English canonical query generation step before retrieval.
- Use the English canonical query for vector retrieval.
- Use the English canonical query for exact-term extraction and exact fallback.
- Use the English canonical query for diagnostic query understanding and scope resolution when possible.
- Require English for grounded answers, clarification questions, and insufficient-evidence responses.
- Preserve fault codes, model numbers, vendor names, product names, commands, parameters, citation labels, and other technical identifiers.
- Keep chat history storing the original user message.
- Keep current answer packet statuses: `grounded`, `needs_clarification`, and `insufficient_evidence`.
- Update tests to assert English-only output policy and canonical retrieval behavior.

## Out of Scope

- UI internationalization.
- Translating static UI labels.
- Adding a new provider.
- Adding a dedicated language-detection provider.
- Adding reranking in this slice.
- Adding multi-query retrieval in this slice.
- Rewriting PDF viewer behavior.
- Forcing deterministic citation selection after answer generation.

## Proposed Flow

1. Receive the user's raw question.
2. Store the raw question in chat history exactly as entered.
3. Build `effectiveQuestion` from previous interpreted problem plus the raw question, preserving existing follow-up behavior.
4. Generate an English canonical question from `effectiveQuestion`.
5. Use the English canonical question for diagnostic understanding, vector embedding, exact-term extraction, exact fallback, and answer generation.
6. Use an English-only response policy for all assistant natural-language output.
7. Build the final answer packet using selected evidence citations exactly as today.

## English Canonical Query

Add a structured helper in `convex/lib/inception.ts`, likely named `generateEnglishQuestion()` or `generateCanonicalEnglishQuestion()`.

Suggested schema:

```ts
type EnglishQuestionGeneration = {
  englishQuestion: string
  usage?: ProviderTokenUsage
}
```

The prompt should instruct the model to:

- Translate or rewrite the user's question into concise English technical search wording.
- Preserve fault codes, alarms, model numbers, vendor names, product names, commands, parameter names, values, units, and citation labels exactly.
- Preserve previous interpreted problem context when present.
- Do not answer the question.
- Do not add new facts or assumptions.
- Return strict JSON with `englishQuestion` only.

If the question is already English, the output should be a cleaned English version with technical identifiers unchanged.

## Fallback Behavior

If canonicalization fails because the provider is temporarily unavailable, the backend should fall back to `effectiveQuestion` for retrieval so the user still gets a best-effort answer path.

Even in fallback mode, the answer prompt must still require English output.

Provider quota or permanent configuration failures should follow the existing provider error handling conventions. The implementation should not hide administrator-facing provider configuration errors if the existing code treats them as hard failures.

## Response Language Policy

Replace dominant-language behavior with an English-only response policy.

`convex/lib/questionLanguage.ts` should return a stable policy like:

```text
Answer every natural-language assistant response field in English, regardless of the user's question language or retrieved context language. Preserve citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, units, and code when translation could change meaning.
```

The function name can either remain `buildResponseLanguagePolicy()` to minimize churn or be renamed only if the implementation remains small and tests are updated accordingly. Keeping the existing function name is preferred for a minimal change.

## Search Changes

`convex/search.ts` should introduce two distinct values:

- `effectiveQuestion`: the raw user question plus previous interpreted problem, used for chat context and canonicalization input.
- `englishQuestion`: the canonical English query, used for retrieval and answer generation.

Use `englishQuestion` in these paths:

- `hasDiagnosticSignals()` and `understandDiagnosticQuery()` after canonicalization.
- `embedSearchQuery()`.
- `isLookupLikeQuery()`.
- `extractExactSearchTerms()`.
- `loadExactResults()` and `loadGlobalExactResultsByTerms()` input.
- `generateGroundedAnswer()` question argument.
- `generateInsufficientEvidenceSummary()` question argument.

Clarification generation should use the diagnostic understanding built from `englishQuestion`, producing English clarification text.

## Citation Behavior

This design improves citation stability by making retrieval candidates language-independent. It does not guarantee identical citations in every case because vector search, exact fallback, and LLM citation selection can still vary when evidence is ambiguous.

The expected improvement is that semantically identical multilingual questions produce the same or highly similar retrieved evidence context, which should make selected PDF pages much more consistent.

If citation drift remains after this slice, future work can add reranking or backend-side citation stabilization.

## Testing Strategy

Update and add tests in the existing Vitest style.

Required test coverage:

- `convex/lib/questionLanguage.test.ts`
  - Assert the policy is English-only.
  - Assert it does not mention dominant-language behavior.
  - Assert technical identifier preservation remains present.

- `convex/lib/inception.test.ts`
  - Cover the new canonical English question generator.
  - Assert the prompt forbids answering the question.
  - Assert the prompt preserves technical identifiers.
  - Assert grounded answer, refusal, and clarification prompts require English output.

- `convex/search.ask.test.ts`
  - Assert non-English questions are canonicalized before `embedSearchQuery()`.
  - Assert exact fallback uses the canonical English query.
  - Assert final answer generation receives the canonical English question.
  - Assert the original user question is still appended to chat history.
  - Assert clarification and insufficient-evidence paths use English-only policy.

Existing tests that assert dominant-language behavior should be updated to assert English-only behavior instead.

## Acceptance Criteria

- Users can ask in any language.
- Assistant natural-language output is always English.
- Retrieval uses an English canonical query when canonicalization succeeds.
- The original user message is saved unchanged.
- Technical identifiers are preserved during canonicalization and answer generation.
- Citation candidates are more stable across Indonesian, English, German, and Spanish versions of the same technical question.
- No UI changes are required for this slice.
- `bun run lint` passes after implementation.

## Future Work

- Add multilingual evaluation fixtures that compare retrieved page sets across translated questions.
- Add reranking if English canonical retrieval still returns noisy candidates.
- Add multi-query retrieval if single canonical retrieval misses important evidence.
- Add backend-side citation stabilization only if the answer model continues to select inconsistent citation subsets from the same evidence context.
