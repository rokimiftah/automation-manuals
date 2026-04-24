# Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic-first retrieval path with a literal keyword fallback so lookup-style questions like `Rockwell Automation` can ground against current chunks instead of falling straight to refusal.

**Architecture:** Keep `convex/search.ts` as the orchestration entry point. Move the query-shape detection, exact-match scoring, and candidate merging into a small pure helper module so the fallback logic is testable without Convex plumbing. Add one bounded internal query for literal matching over current chunks, then merge vector and exact candidates before the existing answer-generation contract runs.

**Tech Stack:** Convex, TypeScript, Vitest, Bun.

---

## File Structure

- Create `convex/lib/hybridRetrieval.ts` for pure query classification, exact-match scoring, and candidate merge/dedup logic.
- Create `convex/lib/hybridRetrieval.test.ts` for deterministic unit tests of the helper logic.
- Modify `convex/schema.ts` to add a current-chunk index that supports bounded literal scans.
- Modify `convex/search.ts` to add an internal exact-match query and to merge vector + exact candidates inside `ask`.
- Create `convex/search.loadExactResults.test.ts` for the new internal query.
- Modify `convex/search.ask.test.ts` to cover a lookup-style question that only succeeds because the exact fallback contributes evidence.
- Leave `convex/lib/mistral.ts` and `convex/lib/answerPacket.ts` unchanged unless a regression shows up during verification.

## Task 1: Add pure hybrid retrieval helpers

**Files:**

- Create: `convex/lib/hybridRetrieval.ts`
- Create: `convex/lib/hybridRetrieval.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest"

import { isLookupLikeQuery, mergeCandidates, rankExactCandidates } from "./hybridRetrieval"

describe("isLookupLikeQuery", () => {
  it("treats short vendor-style phrases as lookup-like", () => {
    expect(isLookupLikeQuery("Rockwell Automation")).toBe(true)
    expect(isLookupLikeQuery("1756-L7SP")).toBe(true)
    expect(isLookupLikeQuery("Where should the module go?")).toBe(false)
  })
})

describe("rankExactCandidates", () => {
  it("scores literal chunk matches above weaker fuzzy matches", () => {
    const ranked = rankExactCandidates("Rockwell Automation", [
      {
        citationLabel: "Page 12",
        chunkId: "chunks_1" as never,
        content: "Rockwell Automation manual excerpt.",
        pageNumber: 12
      },
      {
        citationLabel: "Page 18",
        chunkId: "chunks_2" as never,
        content: "Unrelated controller note.",
        pageNumber: 18
      }
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({
      citationLabel: "Page 12",
      chunkId: "chunks_1",
      source: "exact",
      pageNumber: 12
    })
    expect(ranked[0].score).toBeGreaterThan(0.9)
  })
})

describe("mergeCandidates", () => {
  it("deduplicates the same chunk and keeps the stronger candidate", () => {
    expect(
      mergeCandidates(
        [
          {
            citationLabel: "Page 12",
            chunkId: "chunks_1" as never,
            content: "Rockwell Automation manual excerpt.",
            pageNumber: 12,
            score: 0.71,
            source: "vector"
          }
        ],
        [
          {
            citationLabel: "Page 12",
            chunkId: "chunks_1" as never,
            content: "Rockwell Automation manual excerpt.",
            pageNumber: 12,
            score: 0.98,
            source: "exact"
          }
        ]
      )
    ).toEqual([
      {
        citationLabel: "Page 12",
        chunkId: "chunks_1",
        content: "Rockwell Automation manual excerpt.",
        pageNumber: 12,
        score: 0.98,
        source: "exact"
      }
    ])
  })
})
```

- [ ] **Step 2: Run the helper test and confirm it fails**

Run: `bun test convex/lib/hybridRetrieval.test.ts`

Expected: FAIL because `convex/lib/hybridRetrieval.ts` does not exist yet and the helper functions are undefined.

- [ ] **Step 3: Implement the minimal helper module**

```ts
import type { GenericId } from "convex/values"

export type HybridCandidate = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  content: string
  pageNumber: number
  score: number
  source: "vector" | "exact"
}

const WORD_LIMIT = 6

function normalizeQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ")
}

function tokenize(question: string) {
  return normalizeQuestion(question).split(" ").filter(Boolean)
}

export function isLookupLikeQuery(question: string) {
  const normalized = normalizeQuestion(question)
  if (!normalized) {
    return false
  }

  const tokens = tokenize(normalized)
  if (tokens.length > WORD_LIMIT) {
    return false
  }

  if (/"[^"\n]+"/.test(normalized)) {
    return true
  }

  if (/\b[\w-]*\d[\w-]*\b/.test(normalized)) {
    return true
  }

  return /^[A-Z][\w-]*(?:\s+[A-Z0-9][\w-]*)+$/.test(normalized)
}

function scoreExactCandidate(question: string, candidate: Pick<HybridCandidate, "citationLabel" | "content">) {
  const normalizedQuestion = normalizeQuestion(question)
  if (!normalizedQuestion) {
    return null
  }

  const lowerQuestion = normalizedQuestion.toLowerCase()
  const lowerHaystack = `${candidate.citationLabel}\n${candidate.content}`.toLowerCase()

  if (lowerHaystack.includes(lowerQuestion)) {
    return 0.98
  }

  const tokens = lowerQuestion.split(" ").filter(Boolean)
  if (tokens.length === 0) {
    return null
  }

  const matched = tokens.filter((token) => lowerHaystack.includes(token)).length
  const coverage = matched / tokens.length
  if (coverage < 0.75) {
    return null
  }

  return 0.75 + coverage * 0.2
}

export function rankExactCandidates(question: string, candidates: Array<Omit<HybridCandidate, "score" | "source">>) {
  return candidates
    .map((candidate) => {
      const score = scoreExactCandidate(question, candidate)
      return score === null ? null : { ...candidate, score, source: "exact" as const }
    })
    .filter((candidate): candidate is HybridCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score || (left.source === right.source ? 0 : left.source === "exact" ? -1 : 1))
}

export function mergeCandidates(vectorCandidates: HybridCandidate[], exactCandidates: HybridCandidate[]) {
  const merged = new Map<string, HybridCandidate>()

  for (const candidate of [...vectorCandidates, ...exactCandidates]) {
    const existing = merged.get(candidate.chunkId)
    if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.source === "exact")) {
      merged.set(candidate.chunkId, candidate)
    }
  }

  return [...merged.values()].sort(
    (left, right) => right.score - left.score || (left.source === right.source ? 0 : left.source === "exact" ? -1 : 1)
  )
}
```

- [ ] **Step 4: Run the helper test again and confirm it passes**

Run: `bun test convex/lib/hybridRetrieval.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the helper slice**

```bash
git add convex/lib/hybridRetrieval.ts convex/lib/hybridRetrieval.test.ts
git commit -m "feat(search): add hybrid retrieval helpers"
```

## Task 2: Add bounded exact-match retrieval

**Files:**

- Modify: `convex/schema.ts`
- Modify: `convex/search.ts`
- Create: `convex/search.loadExactResults.test.ts`

- [ ] **Step 1: Write the failing internal-query test**

```ts
import { describe, expect, it, vi } from "vitest"

import { loadExactSearchResults } from "./search"

const loadExactSearchResultsHandler = loadExactSearchResults as typeof loadExactSearchResults & {
  _handler: (
    ctx: unknown,
    args: { documentId?: never; question: string }
  ) => Promise<
    Array<{
      assetId?: never
      citationLabel: string
      chunkId: never
      content: string
      pageNumber: number
      score: number
    }>
  >
}

describe("loadExactSearchResults", () => {
  it("returns current literal matches and ignores stale chunks", async () => {
    const take = vi.fn().mockResolvedValue([
      {
        _id: "chunks_1" as never,
        citationLabel: "Page 12",
        content: "Rockwell Automation manual excerpt.",
        documentId: "documents_1" as never,
        isCurrent: true,
        pageNumber: 12
      },
      {
        _id: "chunks_2" as never,
        citationLabel: "Page 18",
        content: "Rockwell Automation old excerpt.",
        documentId: "documents_2" as never,
        isCurrent: false,
        pageNumber: 18
      }
    ])

    const withIndex = vi.fn().mockReturnValue({
      take
    })

    const get = vi.fn().mockResolvedValueOnce({
      _id: "documents_1" as never,
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    })

    const results = await loadExactSearchResultsHandler._handler(
      {
        db: {
          get,
          query: vi.fn().mockReturnValue({ withIndex })
        }
      } as never,
      {
        question: "Rockwell Automation"
      }
    )

    expect(results).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 12",
        chunkId: "chunks_1",
        content: "Rockwell Automation manual excerpt.",
        pageNumber: 12,
        score: expect.any(Number)
      }
    ])
    expect(take).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test convex/search.loadExactResults.test.ts`

Expected: FAIL because `loadExactSearchResults` is not implemented yet.

- [ ] **Step 3: Add the current-chunk index and the exact-match query**

`convex/schema.ts`

```ts
chunks: defineTable({
  documentId: v.id("documents"),
  ingestionJobId: v.id("ingestionJobs"),
  pageNumber: v.number(),
  chunkType: chunkTypeValidator,
  content: v.string(),
  citationLabel: v.string(),
  isCurrent: v.boolean()
})
  .index("by_document_and_current", ["documentId", "isCurrent"])
  .index("by_document_and_page", ["documentId", "pageNumber"])
  .index("by_current", ["isCurrent"]),
```

`convex/search.ts`

```ts
const EXACT_SCAN_LIMIT = 200

export const loadExactSearchResults = internalQuery({
  args: {
    documentId: v.optional(v.id("documents")),
    question: v.string()
  },
  returns: v.array(searchResultValidator),
  handler: async (ctx, args) => {
    const chunks = args.documentId
      ? await ctx.db
          .query("chunks")
          .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
          .collect()
      : await ctx.db
          .query("chunks")
          .withIndex("by_current", (q) => q.eq("isCurrent", true))
          .take(EXACT_SCAN_LIMIT)

    const ranked = rankExactCandidates(
      args.question,
      chunks.map((chunk) => ({
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber
      }))
    )

    const results: SearchResult[] = []
    for (const candidate of ranked) {
      const chunk = chunks.find((currentChunk) => currentChunk._id === candidate.chunkId)
      if (!chunk) {
        continue
      }

      const document = await ctx.db.get(chunk.documentId)
      if (!document || document.status !== "ready") {
        continue
      }

      results.push({
        assetId: document.sourceAssetId,
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        score: candidate.score
      })
    }

    return results
  }
})
```

- [ ] **Step 4: Run the internal-query test again and confirm it passes**

Run: `bun test convex/search.loadExactResults.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the retrieval slice**

```bash
git add convex/schema.ts convex/search.ts convex/search.loadExactResults.test.ts
git commit -m "feat(search): add bounded exact fallback"
```

## Task 3: Wire hybrid retrieval into `ask`

**Files:**

- Modify: `convex/search.ts`
- Modify: `convex/search.ask.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it("grounds a lookup-style query from the exact fallback when vector search misses", async () => {
  const runQuery = vi
    .fn()
    .mockResolvedValueOnce({
      _id: "chatSessions_1" as never,
      createdAt: 1,
      title: "Rockwell Automation",
      updatedAt: 1
    })
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 12",
        chunkId: "chunks_1" as never,
        content: "Rockwell Automation manual excerpt.",
        pageNumber: 12,
        score: 0.98
      }
    ])

  const runMutation = vi
    .fn()
    .mockResolvedValueOnce("chatMessages_1")
    .mockResolvedValueOnce("chatMessages_2")
    .mockResolvedValueOnce(null)
  const vectorSearch = vi.fn().mockResolvedValue([])

  const packet = await askHandler._handler(
    {
      runMutation,
      runQuery,
      vectorSearch
    } as never,
    {
      question: "Rockwell Automation",
      sessionId: "chatSessions_1" as never
    }
  )

  expect(packet.answerabilityStatus).toBe("grounded")
  expect(packet.answerSummary).toContain("Rockwell Automation")
})
```

- [ ] **Step 2: Run the integration test and confirm it fails**

Run: `bun test convex/search.ask.test.ts`

Expected: FAIL because `ask` still refuses when vector search returns no evidence.

- [ ] **Step 3: Merge vector and exact candidates in `ask`**

```ts
const evidence: SearchResult[] = await ctx.runQuery(internal.search.loadSearchResults, { matches })
const shouldRunExactFallback = isLookupLikeQuery(question) || evidence.length === 0
const exactEvidence = shouldRunExactFallback
  ? await ctx.runQuery(internal.search.loadExactSearchResults, { documentId: args.documentId, question })
  : []
const mergedEvidence = mergeCandidates(
  evidence.map((item) => ({ ...item, source: "vector" as const })),
  exactEvidence.map((item) => ({ ...item, source: "exact" as const }))
)
const evidenceWithIds = mergedEvidence.map((item, index) => ({
  ...item,
  evidenceId: `E${index + 1}`
}))
```

Use `evidenceWithIds` for the context string, `selectEvidenceByCitationIds`, and persisted `answerEvidence` rows exactly as the current flow already does.

When `search.ts` maps `evidenceWithIds` into the model context, it should keep the current `E1`, `E2`, `E3` numbering and ignore the `source` field.

Keep the refusal behavior unchanged when the merged evidence set still cannot support a grounded answer.

- [ ] **Step 4: Run the ask test suite again and confirm it passes**

Run: `bun test convex/search.ask.test.ts`

Expected: PASS, including the existing vector-first regression test and the new exact-fallback test.

- [ ] **Step 5: Commit the orchestration slice**

```bash
git add convex/search.ts convex/search.ask.test.ts
git commit -m "feat(search): use hybrid retrieval in ask"
```

## Task 4: Final verification pass

**Files:**

- No code changes expected unless verification exposes a regression.

- [ ] **Step 1: Run the focused retrieval tests**

Run: `bun test convex/lib/hybridRetrieval.test.ts convex/search.loadExactResults.test.ts convex/search.ask.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the repository lint check**

Run: `bun run lint`

Expected: PASS with zero lint or type errors.

- [ ] **Step 3: Run the full test suite if the focused pass is green**

Run: `bun test`

Expected: PASS.

- [ ] **Step 4: Review any remaining edge cases**

If a failure appears, keep the fix scoped to retrieval and do not change the answer packet contract, the Mistral prompt, or the admin console behavior unless the failure proves one of those layers is the root cause.
