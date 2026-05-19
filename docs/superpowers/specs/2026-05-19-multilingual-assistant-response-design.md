# Multilingual Assistant Response Design

## Goal

Make assistant-generated output multilingual by default. The engineer workspace should answer in the dominant language of the user's question for grounded answers, refusals, and clarification prompts. The platform UI remains English.

## Current State

The current language flow is limited by hardcoded English and Indonesian handling:

- `convex/lib/questionLanguage.ts` returns `code: "en"`, `code: "id"`, or `code: "same_as_question"`.
- `convex/lib/questionLanguage.ts` contains explicit Indonesian and English answer instructions.
- `convex/lib/questionLanguage.ts` returns hardcoded English or Indonesian refusal summaries.
- `convex/lib/diagnosticQuery.ts` accepts `"en" | "id" | "same_as_question"` and returns hardcoded English or Indonesian clarification text.
- `convex/lib/answerPacket.ts` defaults refusal packets to English.
- `convex/lib/inception.ts` already accepts a `QuestionLanguage` instruction, but the instruction is currently constrained by the limited `id/en` detector.

## Scope

In scope:

- Grounded answer generation follows the dominant language of the user's question.
- Insufficient-evidence refusal output follows the dominant language of the user's question.
- Diagnostic clarification output follows the dominant language of the user's question.
- Mixed-language questions use the dominant language, not a mixed style.
- Language flow removes hardcoded `id` and `en` codes from assistant response behavior.
- The existing answer-generation provider may be reused for short assistant meta-responses when the normal grounded-answer path is skipped.
- Tests cover multilingual behavior with non-English, non-Indonesian examples such as Arabic, Spanish, and Japanese.

Out of scope:

- UI internationalization.
- Admin console localization.
- Translating static UI labels, buttons, or errors outside assistant output.
- Adding a new language-detection provider.
- Adding a separate translation provider.
- Maintaining a list of all world languages.
- Translating citation labels, fault codes, product names, vendor names, command names, or other technical identifiers.

## Recommended Approach

Use LLM-led multilingual behavior with explicit dominant-language prompt instructions.

The backend should stop trying to classify the user's language into a small enum. Instead, it should build a reusable language policy instruction that tells the answer model to:

- Detect the dominant language of the user's question.
- Answer in that dominant language.
- Preserve the user's script.
- Preserve technical identifiers and citation labels exactly when translation could change meaning.
- Use the dominant language for mixed-language questions.
- Avoid defaulting to English when the question is in another language.

This approach avoids maintaining a brittle world-language list and keeps the implementation focused on assistant output only.

## Language Policy Model

Replace the current `QuestionLanguage` shape with a language policy that does not expose hardcoded language codes.

Proposed shape:

```ts
export type ResponseLanguagePolicy = {
  instruction: string
}
```

The primary helper should become something like:

```ts
export function buildResponseLanguagePolicy(question: string): ResponseLanguagePolicy
```

The returned instruction should be stable and provider-facing, for example:

```text
Determine the response language from the user's question only, not from retrieved context or manual language. Answer every natural-language response field in the dominant language of the user's question. If the question mixes languages, use the dominant language. If retrieved context is in a different language, translate the answer into the target response language. Preserve the user's script. Do not default to English unless English is the dominant language of the user's question. Do not translate citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, or code when translation could change meaning.
```

The helper may keep the question argument for future policy refinement, but it should not return `id`, `en`, or language-specific copy.

## Grounded Answer Flow

`convex/search.ts` should build a response language policy from `effectiveQuestion` and pass it to answer generation.

`convex/lib/inception.ts` should keep structured JSON output, but its system prompt should include the new language policy. The model should still return strict JSON with:

- `answerSummary`
- `answerSteps`
- `citationIds`

The language policy applies only to natural-language fields. Citation IDs and other identifiers must remain unchanged.

## Refusal Flow

Refusal output should no longer depend on local English or Indonesian string templates.

Required behavior:

- Use the same answer generation path when evidence is present but unsupported by the model. The model can return empty evidence, and the backend converts that to insufficient evidence.
- For no-evidence cases where the grounded-answer path is skipped, generate a short refusal with the existing answer provider and the same response language policy.
- The refusal prompt must not include retrieved context and must not invent evidence.
- The refusal generator should return strict JSON with one natural-language field, such as `answerSummary`.

Implementation notes:

- Reuse the existing Inception provider configuration, key pool, rate-limit accounting, and error handling patterns.
- Keep the refusal concise: state that the official documentation evidence is insufficient to answer safely.
- Do not add a new provider or a dedicated language-detection API.

For this slice, no-evidence refusal must avoid `id/en` branching and must be generated according to the dominant-language policy.

## Clarification Flow

`convex/lib/diagnosticQuery.ts` should stop accepting `"en" | "id" | "same_as_question"`.

The diagnostic query helper should keep rule-based understanding, but localized clarification copy should be generated through a language-policy-aware prompt.

Recommended approach:

- Keep `understandDiagnosticQuery()` pure and deterministic.
- Replace hardcoded English/Indonesian clarification text with a neutral clarification intent object or prompt input.
- Add a short structured clarification generator that uses the existing answer provider and the same response language policy.
- The clarification generator should mention only the missing context needed to select the correct official manual, such as vendor and model.

```ts
export function buildClarificationPromptInput(context: DiagnosticQueryUnderstanding): ClarificationPromptInput
```

The model-facing clarification instruction should require the dominant language of the user's question and should forbid adding product details that were not provided by the user or present in the diagnostic understanding.

## Test Strategy

Update tests to prove the language flow is multilingual and no longer hardcoded to English or Indonesian codes.

Required test coverage:

- `convex/lib/questionLanguage.test.ts`
  - Replace `detectQuestionLanguage` tests with `buildResponseLanguagePolicy` tests.
  - Assert Arabic, Spanish, Japanese, English, Indonesian, and mixed-language questions all receive the same dominant-language policy shape.
  - Assert no `code` field exists.

- `convex/lib/inception.test.ts`
  - Assert the system prompt includes dominant-language instructions.
  - Assert technical identifier preservation remains present.
  - Remove assertions for `Answer in English.` and `Answer in Indonesian.`.
  - Cover structured multilingual refusal generation.
  - Cover structured multilingual clarification generation.

- `convex/lib/diagnosticQuery.test.ts`
  - Remove `"id"` and `"en"` API usage.
  - Add tests proving diagnostic understanding returns missing context without language-specific copy.

- `convex/lib/answerPacket.test.ts`
  - Remove English/Indonesian refusal template assumptions.
  - Assert refusal packet creation accepts generated multilingual summary text and does not require or default to `code: "en"`.

- `convex/search.ask.test.ts`
  - Replace `expect.objectContaining({ code: "en" })` and `expect.objectContaining({ code: "id" })` with assertions against the language policy instruction.
  - Add a non-Latin script question case, such as Arabic or Japanese, and verify the policy reaches grounded answer generation.
  - Add a no-evidence case proving refusal generation receives the policy.
  - Add a needs-clarification case proving clarification generation receives the policy.

## Acceptance Criteria

- No assistant response path depends on `code: "id"`, `code: "en"`, or `"same_as_question"`.
- Grounded answer prompts instruct the model to answer in the dominant language of the user's question.
- Mixed-language questions use the dominant language policy.
- Refusal and clarification paths no longer branch on Indonesian versus English and use the same dominant-language policy.
- Existing answer packet statuses remain unchanged: `grounded`, `insufficient_evidence`, and `needs_clarification`.
- UI labels remain English and are not part of this change.
- `bun run lint` passes after implementation.

## Non-Goals And Deferred Work

- Full UI i18n can be designed separately if needed.
- A dedicated language detection provider is not needed for this slice.
- A world-language marker dictionary is not needed and should not be added.
