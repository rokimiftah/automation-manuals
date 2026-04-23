# Search And Ingestion Medium Pass Design

## Document Status

- Status: Proposed and approved in chat for the next medium-severity pass
- Date: 2026-04-23
- Product: Automation Manuals
- Scope type: Narrow correctness hardening slice

## 1. Goal

Fix the remaining medium-severity search and ingestion correctness issues without widening into a broad backend refactor.

This pass targets three defects only:

- public asset resolution does not respect current/active visibility
- document-scoped vector retrieval can waste top-k slots on stale embeddings
- provider reconciliation can retry forever on permanent errors

## 2. Non-Goals

This pass intentionally does not include:

- admin UX and validation cleanup
- admin auth fail-closed and audit coverage fixes
- broader ingestion observability redesign
- hybrid retrieval or ranking redesign
- chat history redesign

## 3. Design Principles

### 3.1 Tighten existing boundaries

Fix the behavior at the existing public and internal boundaries instead of introducing a new retrieval subsystem.

### 3.2 Prefer current and active corpus state

When there is any ambiguity between stale and current ingestion artifacts, the runtime must prefer current artifacts or fail closed.

### 3.3 Stop infinite background churn

Background reconciliation must distinguish retryable failures from terminal failures so jobs converge to a stable end state.

## 4. Patch M1: Asset Visibility Guard

## 4.1 Problem

`assets.resolveViewerAsset` currently resolves any asset by ID and returns a storage URL as long as the row exists. It does not verify that the asset is current or that the parent document is active.

## 4.2 Target behavior

The public asset resolver must return `null` unless all of the following are true:

- the asset exists
- the asset is current
- the parent document exists
- the parent document is active

## 4.3 Design

Keep the current public query shape but add visibility checks inside `resolveViewerAsset`.

If the asset or document fails the visibility checks, the query returns `null` without exposing a storage URL.

## 5. Patch M2: Current-Only Retrieval Under `documentId`

## 5.1 Problem

When `search.ask` is called with a specific `documentId`, vector search filters only by `documentId`. Stale embeddings can still take top-k positions and are only removed later in `loadSearchResults`, which can lead to false refusals or weak result sets.

## 5.2 Target behavior

When the query is document-scoped, stale embeddings should no longer dominate the effective candidate set used for answer generation.

## 5.3 Design

Convex vector search filters cannot express `documentId AND isCurrent` directly. They only support a single equality expression or an `or` of equality expressions.

So this slice will use a minimal runtime guard instead:

- document-scoped search still filters by `documentId`
- document-scoped search overfetches more than the final candidate count to reduce top-k starvation by stale embeddings
- the effective score threshold is computed from the filtered current evidence, not from the raw vector matches
- global search continues to filter by `isCurrent: true`

This does not eliminate stale embeddings at the vector index layer, but it prevents them from dominating the answerability decision after filtering.

## 6. Patch M3: Bounded Provider Reconciliation

## 6.1 Problem

`ingestion.reconcileProviderJob` reschedules itself on every caught error. If the error is permanent, jobs can loop forever and never converge to `failed`.

## 6.2 Target behavior

Provider reconciliation must stop retrying after a bounded number of failed reconciliation attempts and mark the job and document failed when that ceiling is reached.

## 6.3 Design

Add explicit reconciliation retry tracking to `ingestionJobs`, using a small counter field.

The reconciliation flow will:

1. increment the reconciliation failure count on each caught provider reconciliation error
2. reschedule only while the count remains below the retry ceiling
3. mark the job and document failed once the ceiling is reached
4. reset or leave the counter untouched on successful reconciliation transitions; the important requirement is bounded retries on repeated errors

The implementation may use a constant retry ceiling in code for this slice. The goal is convergence, not runtime configurability.

## 7. Testing Strategy

Each patch must follow TDD with a failing test before production changes.

### Patch M1 tests

- resolver returns `null` for a stale asset
- resolver returns `null` for an asset whose parent document is inactive
- resolver still returns the signed URL for a current asset on an active document

### Patch M2 tests

- document-scoped search uses an expanded candidate limit relative to the global path
- answerability uses the top filtered current-evidence score instead of the raw vector top score
- the global search path still filters by `isCurrent: true`

### Patch M3 tests

- reconciliation retries while below the retry ceiling
- reconciliation marks the job failed at the retry ceiling
- success path does not falsely mark the job failed

## 8. Execution Order

Implement these patches in order:

1. Patch M1: asset visibility guard
2. Patch M2: current-only document retrieval
3. Patch M3: bounded provider reconciliation

This order hardens public evidence access first, then retrieval quality, then background job convergence.

## 9. Acceptance Criteria

This slice is complete when:

- stale or inactive evidence assets no longer resolve publicly
- document-scoped search no longer lets stale embeddings dominate the effective candidate scoring used for answer generation
- provider reconciliation stops after a bounded number of failures and transitions jobs/documents to `failed`
- all targeted tests pass and full `bun run test` plus `bun run lint` remain green
