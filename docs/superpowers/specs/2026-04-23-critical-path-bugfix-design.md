# Critical Path Bug Fix Design

## Document Status

- Status: Proposed and approved in chat for the first bug-fix pass
- Date: 2026-04-23
- Product: Automation Manuals
- Scope type: Narrow stabilization slice

## 1. Goal

Fix the highest-risk runtime issues in the current public-workspace and admin-session implementation without widening scope into a broad refactor.

This slice targets four defects only:

- citations are not truly grounded to the answer packet
- the admin console does not recover cleanly when the session expires after initial validation
- documents can become searchable and active without minimum readiness checks
- OCR fallback is bypassed in the real MinerU finalization path

## 2. Non-Goals

This slice intentionally does not include:

- chat history redesign or replayable structured answer history
- admin audit coverage expansion beyond what is required for the four defects above
- ingestion retry-policy redesign for permanent provider failures
- stale asset access hardening
- admin form validation and retry-button cleanup

Those issues remain valid follow-up work, but they are outside the first critical-path pass.

## 3. Design Principles

### 3.1 Keep the blast radius small

Each fix should stay inside the existing module boundaries unless a boundary is already the root cause of the defect.

### 3.2 Preserve current product behavior when correct

The engineer workspace should still return grounded packets.
The admin console should still use the current session-token model.
The ingestion pipeline should still be MinerU-first with targeted OCR fallback.

### 3.3 Tighten contracts instead of layering workarounds

Where the bug is caused by an ambiguous contract, the fix should make the contract explicit rather than adding heuristics downstream.

## 4. Patch A: Grounded Answer Contract

## 4.1 Problem

The current search flow retrieves several candidate chunks, asks the LLM for a summary and steps, and then attaches all retrieved evidence to the answer packet. This means the returned citations can include chunks that the final answer did not actually use.

## 4.2 Target behavior

The model must choose evidence from a bounded set of retrieval results using stable identifiers supplied by the backend.

The final answer packet must include only the evidence selected by the model.

## 4.3 Proposed contract

The search layer will build context entries with stable evidence identifiers such as `E1`, `E2`, and `E3`.

The answer-generation contract will change from:

- `answerSummary`
- `answerSteps`

to:

- `answerSummary`
- `answerSteps`
- `citationIds`

`citationIds` must be a list of evidence identifiers chosen from the supplied context. Unknown identifiers are ignored. If no valid identifiers remain after validation, the result is treated as insufficient evidence.

## 4.4 Data-flow changes

1. Retrieval still returns scored chunk candidates.
2. The backend assigns each candidate a stable evidence identifier.
3. The LLM receives question plus structured context.
4. The backend validates the returned `citationIds` against the supplied evidence map.
5. The answer packet is built only from validated selected evidence.
6. Persisted `answerEvidence` rows are written only for selected evidence.

## 4.5 Minimality constraints

- Do not redesign the whole chat schema in this slice.
- Do not require the model to emit full chunk IDs or database identifiers.
- Do not attach every retrieved chunk as a fallback convenience.

## 5. Patch B: Admin Session Recovery

## 5.1 Problem

The admin route validates the stored token when the gate loads, but the active console does not reliably recover when the session expires later. Sign-out also depends on the server mutation succeeding before the client clears local state.

## 5.2 Target behavior

The admin route must recover to the login form when the session is no longer valid, whether the cause is:

- initial validation failure
- reactive validation returning `null`
- local expiry time elapsing
- a protected admin mutation failing with an admin-session error

Sign-out must always clear local session state even if the sign-out mutation fails.

## 5.3 Proposed client behavior

The session gate becomes the single owner of local admin session lifecycle.

It will provide a shared `clearSession` path that:

- removes the token from `sessionStorage`
- clears local session state
- optionally sets a user-facing message

It will also schedule a local expiry timeout based on `expiresAt` so the browser does not wait for a server-side revocation write before returning to the login form.

Protected admin mutation handlers exposed to the console will route known auth failures through the same `clearSession` path.

## 5.4 Minimality constraints

- Keep the session-token architecture and server-side auth checks unchanged.
- Do not introduce cookies or a proxy layer.
- Do not redesign all admin queries around a new data-fetching abstraction.

## 6. Patch C: Document Readiness Gate

## 6.1 Problem

The current readiness helper marks a document as `ready` and `isActive: true` without validating that minimum evidence artifacts exist.

## 6.2 Target behavior

A document can become `ready` only when all of the following are true:

- a current source PDF asset exists
- at least one parsed page exists
- at least one current chunk exists
- embeddings and chunks remain aligned through the write path

If the ingestion result is empty or incomplete, the document must not become active.

## 6.3 Proposed design

Readiness validation will become an explicit helper that checks required artifact counts before building the final ready patch.

`replaceParsedContent` will only activate the document after those checks pass.

`markReady` will be kept safe by using the same validation path instead of directly flipping the document status.

## 6.4 Failure behavior

If the normalized payload is empty or invalid, the mutation should fail fast so the caller can transition the job and document to `failed` instead of silently activating a broken corpus entry.

## 7. Patch D: OCR Fallback in the Real Pipeline

## 7.1 Problem

The production MinerU finalization path calls `buildDocumentPayload` with already parsed pages and strips the `needsOcrFallback` signal before normalization. As a result, the OCR path only exists in the legacy test-oriented branch and not in the actual runtime path.

## 7.2 Target behavior

When MinerU yields a page that still looks image-only or too sparse, the finalization flow should perform targeted OCR for that page before chunk extraction and embedding.

## 7.3 Proposed design

`buildDocumentPayload` will support a parsed-pages path that can still run OCR when the caller provides:

- the original source URL
- the OCR function
- parsed pages that retain `needsOcrFallback`

The function will:

1. normalize parsed pages
2. OCR only pages flagged for fallback
3. renormalize after fallback replacement
4. build chunks and embeddings from the final page content

`finalizeProviderResult` will stop discarding the fallback signal and will pass the source URL plus OCR dependency needed for the real recovery path.

## 7.4 Minimality constraints

- Keep MinerU as the primary parser.
- Use OCR only for flagged pages.
- Avoid broad OCR of every page.

## 8. Testing Strategy

Each patch must follow TDD with a failing test before production changes.

### Patch A tests

- verify that only selected evidence becomes citations
- verify that invalid or empty `citationIds` produce an insufficient-evidence packet
- verify that persisted `answerEvidence` rows match selected citations only

### Patch B tests

- verify the admin gate clears the local token on reactive invalidation
- verify the admin gate clears the local token when local expiry time elapses
- verify sign-out clears local state even if the mutation rejects

### Patch C tests

- verify readiness activation fails when pages or chunks are missing
- verify a valid parsed payload still activates the document

### Patch D tests

- verify OCR is called only for fallback pages in the parsed-pages branch
- verify OCR output replaces sparse page content before chunking
- verify non-fallback pages skip OCR

## 9. Execution Order

The patches should be implemented in this order:

1. Patch A: grounded answer contract
2. Patch B: admin session recovery
3. Patch C: document readiness gate
4. Patch D: OCR fallback in the real pipeline

This order fixes user-visible trust issues first, then admin recovery, then ingestion correctness.

## 10. Acceptance Criteria

This slice is complete when:

- answer packets cite only evidence explicitly selected by the model contract
- admin session expiry or sign-out failure no longer leaves `/admin` stuck in a broken authenticated state
- documents cannot become `ready` and active without minimum evidence artifacts
- the MinerU finalization path actually executes targeted OCR fallback for flagged pages
- all targeted tests pass and full `bun run test` plus `bun run lint` remain green
