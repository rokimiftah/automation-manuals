# Hybrid Retrieval Design

## Document Status

- Status: Proposed and approved in chat for the hybrid retrieval pass
- Date: 2026-04-24
- Product: Automation Manuals
- Scope type: Narrow retrieval correctness slice

## 1. Goal

Reduce false refusals for lookup-style questions by combining semantic retrieval with a literal keyword fallback.

The primary target is questions where the user already knows the phrase they are looking for, such as vendor names, model numbers, product names, page labels, and short exact phrases like `Rockwell Automation`.

## 2. Non-Goals

This pass intentionally does not include:

- a new search service or external search engine
- a full-text index migration
- chat UI changes
- answer generation contract changes beyond feeding better evidence into the existing flow
- broad ranking research or tunable relevance experimentation

The goal is to make the current answer path safer and more useful, not to redesign search into a new subsystem.

## 3. Design Principles

### 3.1 Semantic first, literal when needed

Vector search remains the default retrieval path for natural-language questions.

Literal matching is a fallback for queries that look like lookups or when semantic retrieval is too weak to support a grounded answer.

### 3.2 Prefer current corpus state

Only current chunks from ready documents may participate in answer retrieval.

This keeps the fallback aligned with the same corpus freshness rules already used by the vector path.

### 3.3 Keep fallback deterministic and small

The keyword path should use simple substring and token coverage checks, not a second model.

The resulting candidate list must be deduplicated by `chunkId` and ordered deterministically so citations stay stable.

### 3.4 Fail closed when neither path is strong enough

If the hybrid candidate set still does not support a grounded answer, the system should continue to return the existing refusal packet.

## 4. Retrieval Flow

## 4.1 Current behavior

`convex/search.ts` currently does the following:

1. embed the question
2. run vector search over `chunkEmbeddings`
3. load the matching chunks
4. build a single context string
5. ask the model for `answerSummary`, `answerSteps`, and `citationIds`
6. refuse if the model does not return usable evidence

That flow stays intact, but the candidate generation step becomes hybrid.

## 4.2 New candidate generation

The retrieval step will produce candidates from two sources:

- vector candidates from the existing embedding search
- exact candidates from a literal match pass over current chunk text

The final candidate set is the union of those two sources, deduplicated by `chunkId`.

## 4.3 Literal fallback trigger

Exact keyword fallback should run when at least one of the following is true:

- the query is classified as lookup-like
- vector search returns no usable candidates after current-row filtering

A query is classified as lookup-like when it meets any of these conditions:

- it has 6 words or fewer
- it contains a quoted phrase
- it contains an identifier-style token with digits or hyphens
- it contains a short title-case proper noun phrase

Examples include:

- vendor names
- product names
- catalog numbers
- part numbers
- quoted phrases
- short title-style fragments

The intent is to catch questions like `Rockwell Automation` without forcing exact matching on long reasoning prompts.

## 4.4 Exact candidate search

The exact fallback scans current chunks and scores them using straightforward text checks:

- exact phrase match in `chunks.content`
- case-insensitive substring match in `chunks.content`
- exact or substring match in `chunks.citationLabel`
- token coverage for short multi-word queries

Only `chunks` rows with `isCurrent = true` may be considered.

For document-scoped questions, the exact path should only scan the current chunks for that document.

For global questions, the exact path should scan current chunks from ready documents up to a bounded cap, then stop.

The implementation should use explicit constants for this cap, not an unbounded table scan. The initial design target is to stop after enough strong literal matches are found to build a useful context window, or after scanning a fixed upper bound of current chunks, whichever comes first.

## 4.5 Candidate ordering

The merged candidate list should preserve a stable, explainable priority:

- If the query is lookup-like, exact matches should rank before vector-only matches.
- If the query is natural-language and vector results are strong, vector matches should remain first and exact matches should only fill gaps.
- If the same `chunkId` appears in both paths, keep the stronger version once.

This keeps the model context focused on the most relevant evidence instead of mixing duplicate chunks.

## 4.6 Evidence identifiers and answer contract

The backend should still assign stable `E1`, `E2`, `E3` identifiers after merging candidates.

`generateGroundedAnswer` can continue to return `citationIds` against those identifiers.

No changes are required to the answer packet schema or refusal packet shape for this pass.

## 5. Failure Handling

If the vector path returns nothing and the exact path also returns nothing useful, the system should continue to return the existing refusal packet.

If the model returns invalid `citationIds` or no valid steps, the current refusal behavior should remain unchanged.

The hybrid retrieval pass should not invent citations or infer evidence that is not present in the merged candidate set.

## 6. Testing Strategy

The retrieval change should be covered with targeted tests before any production change is merged.

### 6.1 Exact fallback tests

- `search.ask` returns grounded evidence when vector search misses but a current chunk contains the literal phrase
- `search.ask` returns grounded evidence for a short lookup-style query like `Rockwell Automation`
- the exact fallback respects `isCurrent = true`

### 6.2 Merge and dedupe tests

- the same chunk returned by vector and exact search appears only once in the merged context
- exact matches are ordered ahead of vector-only matches for lookup-like queries
- vector-only ordering is preserved for natural-language questions when vector evidence is strong

### 6.3 Refusal safety tests

- when both retrieval paths fail, the existing refusal packet is still returned
- invalid or empty `citationIds` still produce the refusal packet

## 7. Acceptance Criteria

This slice is complete when:

- a query like `Rockwell Automation` can ground against a current chunk containing that phrase even if vector search is weak or empty
- natural-language questions still behave primarily as semantic retrieval
- current/stale filtering stays intact
- candidate deduplication prevents duplicate citations from the same chunk
- all targeted tests pass and `bun run lint` remains green after implementation
