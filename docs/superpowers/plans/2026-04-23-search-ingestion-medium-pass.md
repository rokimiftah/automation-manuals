# Search And Ingestion Medium Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden search and ingestion correctness by guarding public asset visibility, reducing stale-document retrieval bias in document-scoped search, and bounding provider reconciliation retries.

**Architecture:** Keep the fixes at the current public and internal boundaries. Public asset resolution will fail closed for stale or inactive artifacts; document-scoped search will overfetch then score only current evidence because Convex vector filters cannot express `documentId AND isCurrent`; and provider reconciliation will track repeated reconciliation failures until a bounded ceiling marks the job failed.

**Tech Stack:** Convex actions/queries/mutations, Convex vector indexes and scheduler, Vitest, TypeScript.

**Execution note:** Do not create git commits unless the user explicitly asks for them.

---

## Research Notes

- Convex vector search docs: `https://docs.convex.dev/vector-search`
  - Vector search is action-only.
  - Filter expressions are limited to a single `q.eq(...)` or `q.or(...)` combinations; there is no `AND` support in `VectorFilterBuilder`.
  - Because of that API limit, document-scoped search cannot filter by `documentId` and `isCurrent` simultaneously at the vector index layer.
- Convex scheduled functions docs: `https://docs.convex.dev/scheduling/scheduled-functions`
  - `ctx.scheduler.runAfter()` may be called from actions and mutations.
  - Scheduled actions are at-most-once and are not automatically retried by Convex.
  - Bounded manual retries in application code are the correct place to stop infinite reconciliation loops.

## File Structure

- Modify: `convex/assets.ts` - add a pure asset-visibility helper and fail-closed checks in the public resolver
- Create: `convex/assets.test.ts` - unit tests for current/active asset visibility rules
- Modify: `convex/search.ts` - overfetch document-scoped vector candidates and compute the answerability score from filtered current evidence
- Create: `convex/search.test.ts` - unit tests for limit selection and evidence-score selection helpers
- Modify: `convex/schema.ts` - add reconciliation failure tracking to `ingestionJobs`
- Modify: `convex/ingestion.ts` - apply bounded reconciliation retry behavior and persist failure counts
- Create: `convex/lib/providerRetry.ts` - pure helper for bounded reconciliation retry decisions
- Create: `convex/lib/providerRetry.test.ts` - unit tests for retry vs fail decisions

### Task 1: Guard Public Viewer Asset Visibility

**Files:**

- Modify: `convex/assets.ts`
- Test: `convex/assets.test.ts`

- [ ] **Step 1: Write the failing visibility tests**

```ts
// convex/assets.test.ts
import { describe, expect, it } from "vitest"

import { canResolveViewerAsset } from "./assets"

describe("canResolveViewerAsset", () => {
  it("rejects stale assets", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: false },
        document: { isActive: true }
      })
    ).toBe(false)
  })

  it("rejects assets from inactive documents", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: true },
        document: { isActive: false }
      })
    ).toBe(false)
  })

  it("allows current assets on active documents", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: true },
        document: { isActive: true }
      })
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the focused asset tests to verify they fail**

Run: `bunx vitest run convex/assets.test.ts`

Expected: FAIL because `canResolveViewerAsset` does not exist yet.

- [ ] **Step 3: Implement the minimal visibility helper and fail-closed resolver**

```ts
// convex/assets.ts
import { v } from "convex/values"

import { query } from "./_generated/server"

export function canResolveViewerAsset(input: { asset: { isCurrent: boolean } | null; document: { isActive: boolean } | null }) {
  return input.asset?.isCurrent === true && input.document?.isActive === true
}

export const resolveViewerAsset = query({
  args: { assetId: v.id("documentAssets") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documentAssets"),
      kind: v.literal("source_pdf"),
      pageNumber: v.optional(v.number()),
      url: v.string()
    })
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    const document = asset ? await ctx.db.get(asset.documentId) : null
    if (!canResolveViewerAsset({ asset, document })) {
      return null
    }

    const url = await ctx.storage.getUrl(asset.storageId)
    if (!url) {
      return null
    }

    return {
      _id: asset._id,
      kind: "source_pdf" as const,
      ...(asset.pageNumber === undefined ? {} : { pageNumber: asset.pageNumber }),
      url
    }
  }
})
```

- [ ] **Step 4: Re-run the focused asset tests**

Run: `bunx vitest run convex/assets.test.ts`

Expected: PASS

### Task 2: Reduce Stale Bias In Document-Scoped Search

**Files:**

- Modify: `convex/search.ts`
- Test: `convex/search.test.ts`

- [ ] **Step 1: Write the failing search-policy tests**

```ts
// convex/search.test.ts
import { describe, expect, it } from "vitest"

import { DOCUMENT_SCOPED_VECTOR_LIMIT, getTopEvidenceScore, getVectorSearchLimit } from "./search"

describe("getVectorSearchLimit", () => {
  it("uses an expanded limit for document-scoped searches", () => {
    expect(getVectorSearchLimit("documents_1" as never)).toBe(DOCUMENT_SCOPED_VECTOR_LIMIT)
  })

  it("keeps the default limit for global searches", () => {
    expect(getVectorSearchLimit(undefined)).toBe(6)
  })
})

describe("getTopEvidenceScore", () => {
  it("uses filtered current evidence scores instead of raw vector match order", () => {
    expect(getTopEvidenceScore([{ score: 0.58 }, { score: 0.73 }, { score: 0.64 }])).toBe(0.73)
  })

  it("returns 0 when there is no current evidence", () => {
    expect(getTopEvidenceScore([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run the focused search tests to verify they fail**

Run: `bunx vitest run convex/search.test.ts`

Expected: FAIL because the exported limit and evidence-score helpers do not exist yet.

- [ ] **Step 3: Add minimal helpers for search limit and filtered evidence scoring**

```ts
// convex/search.ts
export const DEFAULT_VECTOR_LIMIT = 6
export const DOCUMENT_SCOPED_VECTOR_LIMIT = 24

export function getVectorSearchLimit(documentId?: GenericId<"documents">) {
  return documentId ? DOCUMENT_SCOPED_VECTOR_LIMIT : DEFAULT_VECTOR_LIMIT
}

export function getTopEvidenceScore(evidence: Array<{ score: number }>) {
  return evidence.reduce((highest, item) => Math.max(highest, item.score), 0)
}
```

- [ ] **Step 4: Use the helpers inside `search.ask`**

```ts
// convex/search.ts (inside ask)
const matches = embedding
  ? await ctx.vectorSearch("chunkEmbeddings", "by_embedding", {
      filter: (q) => (args.documentId ? q.eq("documentId", args.documentId) : q.eq("isCurrent", true)),
      limit: getVectorSearchLimit(args.documentId),
      vector: embedding
    })
  : []

const evidence: SearchResult[] = await ctx.runQuery(internal.search.loadSearchResults, { matches })
const topScore = getTopEvidenceScore(evidence)

if (evidence.length === 0 || topScore < 0.55) {
  const packet = buildRefusalPacket(sessionId)

  await ctx.runMutation(internal.chats.appendMessage, {
    answerabilityStatus: packet.answerabilityStatus,
    content: packet.answerSummary,
    role: "assistant",
    sessionId
  })

  return packet
}
```

- [ ] **Step 5: Re-run the focused search tests**

Run: `bunx vitest run convex/search.test.ts`

Expected: PASS

### Task 3: Bound Provider Reconciliation Retries

**Files:**

- Create: `convex/lib/providerRetry.ts`
- Test: `convex/lib/providerRetry.test.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/ingestion.ts`

- [ ] **Step 1: Write the failing bounded-retry tests**

```ts
// convex/lib/providerRetry.test.ts
import { describe, expect, it } from "vitest"

import { getProviderReconcileDecision, PROVIDER_RECONCILE_RETRY_LIMIT } from "./providerRetry"

describe("getProviderReconcileDecision", () => {
  it("retries while the failure count remains below the ceiling", () => {
    expect(getProviderReconcileDecision(1)).toEqual({
      nextFailureCount: 2,
      shouldFail: false
    })
  })

  it("fails once the retry ceiling is reached", () => {
    expect(getProviderReconcileDecision(PROVIDER_RECONCILE_RETRY_LIMIT - 1)).toEqual({
      nextFailureCount: PROVIDER_RECONCILE_RETRY_LIMIT,
      shouldFail: true
    })
  })
})
```

- [ ] **Step 2: Run the focused retry-policy tests to verify they fail**

Run: `bunx vitest run convex/lib/providerRetry.test.ts`

Expected: FAIL because `providerRetry.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal retry-decision helper**

```ts
// convex/lib/providerRetry.ts
export const PROVIDER_RECONCILE_RETRY_LIMIT = 3

export function getProviderReconcileDecision(currentFailureCount: number) {
  const nextFailureCount = currentFailureCount + 1
  return {
    nextFailureCount,
    shouldFail: nextFailureCount >= PROVIDER_RECONCILE_RETRY_LIMIT
  }
}
```

- [ ] **Step 4: Extend the schema and ingestion validators to track reconciliation failures**

```ts
// convex/schema.ts (ingestionJobs fields excerpt)
ingestionJobs: defineTable({
  documentId: v.id("documents"),
  requestedByAdmin: v.string(),
  status: ingestionStatusValidator,
  errorMessage: v.optional(v.string()),
  provider: v.optional(v.literal("mineru")),
  providerBatchId: v.optional(v.string()),
  providerCallbackVerifiedAt: v.optional(v.number()),
  providerDataId: v.optional(v.string()),
  providerErrorCode: v.optional(v.number()),
  providerErrorMessage: v.optional(v.string()),
  providerLastCheckedAt: v.optional(v.number()),
  providerReconcileFailureCount: v.optional(v.number()),
  providerResultUrl: v.optional(v.string()),
  providerState: v.optional(v.string()),
  providerSubmittedAt: v.optional(v.number()),
  providerTraceId: v.optional(v.string()),
  sourceStorageId: v.optional(v.id("_storage")),
  sourceFileName: v.optional(v.string()),
  sourceMimeType: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number()
})
```

```ts
// convex/ingestion.ts (jobByIdValidator excerpt)
providerReconcileFailureCount: v.optional(v.number()),
```

- [ ] **Step 5: Initialize, reset, and bound reconciliation failures in the ingestion flow**

```ts
// convex/ingestion.ts
import { getProviderReconcileDecision } from "./lib/providerRetry"

// inside recordProviderSubmission patch
await ctx.db.patch(args.jobId, {
  priorityQuotaBucket: args.priorityQuotaBucket,
  provider: "mineru",
  providerBatchId: args.providerBatchId,
  providerReconcileFailureCount: 0,
  providerState: "pending",
  ...(args.providerTraceId === undefined ? {} : { providerTraceId: args.providerTraceId }),
  providerSubmittedAt: Date.now(),
  sourceFileName: args.sourceFileName,
  sourceMimeType: args.sourceMimeType,
  sourceStorageId: args.sourceStorageId,
  status: "waiting_provider",
  updatedAt: Date.now()
})

// extend recordProviderProgress args
providerReconcileFailureCount: (v.optional(v.number()),
  // extend recordProviderProgress patch
  await ctx.db.patch(args.jobId, {
    ...(args.providerDataId === undefined ? {} : { providerDataId: args.providerDataId }),
    ...(args.providerErrorCode === undefined ? {} : { providerErrorCode: args.providerErrorCode }),
    ...(args.providerErrorMessage === undefined ? {} : { providerErrorMessage: args.providerErrorMessage }),
    ...(args.providerReconcileFailureCount === undefined
      ? {}
      : { providerReconcileFailureCount: args.providerReconcileFailureCount }),
    ...(args.providerResultUrl === undefined ? {} : { providerResultUrl: args.providerResultUrl }),
    ...(args.providerTraceId === undefined ? {} : { providerTraceId: args.providerTraceId }),
    providerLastCheckedAt: Date.now(),
    providerState: args.providerState,
    status: args.status,
    updatedAt: Date.now()
  }))
```

```ts
// convex/ingestion.ts (inside the non-failed provider-result branch)
await ctx.runMutation(internal.ingestion.recordProviderProgress, {
  jobId: args.jobId,
  ...(result.dataId === undefined ? {} : { providerDataId: result.dataId }),
  ...(result.errorCode === undefined ? {} : { providerErrorCode: result.errorCode }),
  ...(result.errorMessage === undefined ? {} : { providerErrorMessage: result.errorMessage }),
  ...(result.resultUrl === undefined ? {} : { providerResultUrl: result.resultUrl }),
  providerReconcileFailureCount: 0,
  providerState: result.state,
  ...(providerResult.traceId === undefined ? {} : { providerTraceId: providerResult.traceId }),
  status: nextStatus
})
```

```ts
// convex/ingestion.ts (inside the provider-result failed branch)
await ctx.runMutation(internal.ingestion.recordProviderProgress, {
  jobId: args.jobId,
  ...(result.dataId === undefined ? {} : { providerDataId: result.dataId }),
  ...(result.errorCode === undefined ? {} : { providerErrorCode: result.errorCode }),
  ...(result.errorMessage === undefined ? {} : { providerErrorMessage: result.errorMessage }),
  providerReconcileFailureCount: 0,
  providerState: result.state,
  ...(providerResult.traceId === undefined ? {} : { providerTraceId: providerResult.traceId }),
  status: job.status
})
```

```ts
// convex/ingestion.ts (inside catch block)
const decision = getProviderReconcileDecision(job.providerReconcileFailureCount ?? 0)

await ctx.runMutation(internal.ingestion.recordProviderProgress, {
  jobId: args.jobId,
  providerErrorMessage: errorMessage,
  providerReconcileFailureCount: decision.nextFailureCount,
  providerState: job.providerState || "pending",
  status: job.status
})

if (decision.shouldFail) {
  await ctx.runMutation(internal.documents.markFailed, {
    errorMessage,
    jobId: args.jobId,
    documentId: job.documentId
  })
  return null
}

await ctx.scheduler.runAfter(selectBackoffDelay(job.status), internal.ingestion.reconcileProviderJob, {
  jobId: args.jobId
})
return null
```

- [ ] **Step 6: Re-run the focused retry-policy tests and related ingestion tests**

Run: `bunx vitest run convex/lib/providerRetry.test.ts`

Expected: PASS

Run: `bunx vitest run convex/lib/providerRetry.test.ts convex/lib/mineru.test.ts convex/lib/mineruCallback.test.ts convex/lib/mineruResult.test.ts`

Expected: PASS

### Task 4: Full Verification

**Files:**

- No code changes expected

- [ ] **Step 1: Run the entire test suite**

Run: `bun run test`

Expected: PASS

- [ ] **Step 2: Run lint, formatting, and type verification**

Run: `bun run lint`

Expected: PASS with no type errors and no Biome issues

- [ ] **Step 3: Verify the implementation against the approved spec**

Check:

- `resolveViewerAsset` returns `null` for stale or inactive artifacts
- document-scoped search uses expanded vector overfetch and filtered current-evidence scoring
- reconciliation retries stop at the configured ceiling and mark the job/document failed

- [ ] **Step 4: Prepare the user-facing summary**

Include:

- files changed
- tests added or updated
- verification commands and outputs
- remaining deferred medium-severity domains outside Search/Ingestion
