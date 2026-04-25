# Multilingual Response Language Design

## Document Status

- Status: Approved in chat
- Date: 2026-04-25
- Product: Automation Manuals
- Scope type: Narrow answer-language behavior slice

## 1. Goal

Make assistant answers follow the user's question language automatically.

Examples for v1:

- English question -> English answer
- Indonesian question -> Indonesian answer
- Other supported natural languages -> answer in that same language

This pass only changes output language behavior. It does not change retrieval strategy.

## 2. Non-Goals

This pass intentionally does not include:

- translating the user's question before retrieval
- translating source documents
- filtering or ranking documents by document language
- adding a manual language picker in the UI
- storing a persistent language preference per session
- retrying the model automatically if it answers in the wrong language

The goal is to improve answer-language alignment with the smallest safe change.

## 3. Design Principles

### 3.1 Keep retrieval unchanged

The current retrieval flow in `convex/search.ts` remains the same.

Question embeddings, vector search, exact fallback, evidence selection, and citation assembly should not become language-aware in this pass.

### 3.2 Detect language once per question

The backend should infer a response language from the question text before calling the answer model.

That inferred language is only used to shape the generated answer and refusal text.

### 3.3 Preserve technical fidelity

The answer should follow the user's language, while leaving technical identifiers, product names, code snippets, terminal commands, and citation labels unchanged when translating them could change meaning.

### 3.4 Fail closed when evidence is insufficient

The existing refusal behavior remains in place.

If the system cannot ground an answer in retrieved evidence, it should still refuse, but the refusal text must follow the inferred response language.

## 4. Architecture

## 4.1 Current behavior

`convex/search.ts` currently:

1. creates or validates a chat session
2. embeds the question
3. loads retrieval candidates
4. builds a grounded context string
5. calls `generateGroundedAnswer(question, context)`
6. returns either a grounded packet or an English refusal packet

The behavior gap is that the answer-generation layer does not receive an explicit output-language instruction.

## 4.2 New language helper

Add a small pure helper in `convex/lib/` that inspects the question text and returns a response-language descriptor for answer generation.

This helper should stay intentionally small and deterministic. It does not need to solve general translation or perfect language classification.

The initial behavior should cover:

- Indonesian
- English
- a generic fallback for other Unicode-script questions
- a safe fallback for ambiguous or empty input

## 4.3 Answer-generation update

`convex/lib/mistral.ts` should accept the inferred response-language descriptor in `generateGroundedAnswer(...)`.

The system prompt should explicitly require that the answer:

- uses only the provided context
- returns strict JSON with the existing keys
- writes `answerSummary` and `answerSteps` in the target language
- keeps technical identifiers and citation labels unchanged when safer not to translate

This keeps the answer packet contract stable while changing only the language policy.

## 4.4 Refusal-language update

`convex/lib/answerPacket.ts` should stop hardcoding the refusal summary in English.

Instead, refusal packet creation should accept the inferred response language and emit the corresponding refusal copy in that language.

The refusal packet shape stays unchanged.

## 4.5 No schema or UI changes

This pass should not modify:

- Convex schema
- document ingestion shape
- question composer inputs
- session storage shape

The feature should work automatically from the question text alone.

## 5. Error Handling

If the language helper cannot classify the question confidently, the system should fall back to a stable default behavior instead of guessing aggressively.

For v1, the helper may return a generic fallback instruction that tells the model to answer in the same language as the user's question.

If the model still fails to produce a valid grounded answer, the existing refusal path still applies.

If the question mixes languages, the system should prefer the dominant language signal, while preserving technical terms exactly.

## 6. Testing Strategy

The change should be covered by focused tests before production code is finalized.

### 6.1 Language helper tests

- detect Indonesian questions as Indonesian
- detect English questions as English
- keep a stable fallback for ambiguous or mostly symbolic input
- handle mixed-language questions without throwing

### 6.2 Prompt contract tests

- `generateGroundedAnswer(...)` should send a system instruction that includes the response-language requirement
- the existing JSON response contract must remain unchanged

### 6.3 Refusal behavior tests

- refusal packet copy should be Indonesian for Indonesian questions
- refusal packet copy should remain English for English questions

### 6.4 Search flow tests

- `search.ask` should pass the inferred response language into grounded answer generation
- `search.ask` should return a refusal packet in the user's language when evidence is insufficient
- retrieval result loading should remain unchanged by this feature

## 7. Acceptance Criteria

This slice is complete when:

- grounded answers follow the language of the user's question
- refusal answers also follow the language of the user's question
- technical terms, code, and citation labels are preserved when translation would be risky
- retrieval behavior remains unchanged
- targeted tests pass and `bun run lint` stays green
