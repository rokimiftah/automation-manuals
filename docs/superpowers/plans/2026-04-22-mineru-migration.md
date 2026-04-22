# MinerU Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current LlamaParse plus Mistral OCR ingestion path with MinerU Precision API while keeping page-accurate citations, the existing PDF evidence viewer, and the current retrieval and answer-generation path.

**Architecture:** Convex remains the orchestration layer for ingestion jobs, but parsing becomes an external asynchronous workflow driven by MinerU upload submission, callback delivery, and polling fallback. MinerU structured page JSON becomes the canonical extraction format, which is normalized into the existing `documents`, `documentPages`, `chunks`, and `chunkEmbeddings` tables so the current search and viewer layers can keep working.

**Tech Stack:** Convex, Astro, React, TypeScript, MinerU Precision API, Mistral embeddings and answer generation, Vitest, Biome, TypeScript compiler.

---

### Task 1: Replace provider configuration inputs

**Files:**

- Modify: `convex/lib/env.ts`
- Test: `convex/lib/env.test.ts`

- [ ] **Step 1: Write the failing env tests for MinerU config**

```ts
import { describe, expect, it } from "vitest"

import { getProviderEnv } from "./env"

describe("getProviderEnv", () => {
  it("returns MinerU configuration when all required env vars are present", () => {
    expect(
      getProviderEnv({
        MINERU_API_TOKEN: " token ",
        MINERU_CALLBACK_SEED: " seed ",
        MISTRAL_API_KEY: " mistral ",
        MISTRAL_CHAT_MODEL: "mistral-small-latest",
        MISTRAL_EMBED_MODEL: "mistral-embed"
      })
    ).toMatchObject({
      mineruApiToken: "token",
      mineruCallbackSeed: "seed",
      mistralApiKey: "mistral"
    })
  })

  it("throws when MINERU_API_TOKEN is missing", () => {
    expect(() =>
      getProviderEnv({
        MINERU_CALLBACK_SEED: "seed",
        MISTRAL_API_KEY: "mistral"
      })
    ).toThrow("MINERU_API_TOKEN is required")
  })
})
```

- [ ] **Step 2: Run the env test to verify it fails**

Run: `bun test convex/lib/env.test.ts`
Expected: FAIL because `getProviderEnv` still expects `LLAMA_CLOUD_API_KEY` and does not expose MinerU fields.

- [ ] **Step 3: Replace the provider env implementation**

```ts
type ProviderEnvInput = Partial<
  Record<
    | "MINERU_API_TOKEN"
    | "MINERU_CALLBACK_SEED"
    | "MINERU_CALLBACK_URL"
    | "MINERU_DAILY_PRIORITY_PAGES"
    | "MINERU_DAILY_FILE_LIMIT"
    | "MINERU_SUBMIT_RATE_PER_MINUTE"
    | "MINERU_RESULT_QUERY_RATE_PER_MINUTE"
    | "MISTRAL_API_KEY"
    | "MISTRAL_CHAT_MODEL"
    | "MISTRAL_EMBED_MODEL",
    string | undefined
  >
>

export type ProviderEnv = {
  mineruApiToken: string
  mineruCallbackSeed: string
  mineruCallbackUrl?: string
  mineruDailyPriorityPages: number
  mineruDailyFileLimit: number
  mineruSubmitRatePerMinute: number
  mineruResultQueryRatePerMinute: number
  mistralApiKey: string
  mistralChatModel: string
  mistralEmbedModel: string
}
```

- [ ] **Step 4: Run the env test to verify it passes**

Run: `bun test convex/lib/env.test.ts`
Expected: PASS

### Task 2: Expand ingestion status and job metadata

**Files:**

- Modify: `convex/lib/validators.ts`
- Modify: `convex/lib/ingestionState.ts`
- Modify: `convex/schema.ts`
- Test: `convex/lib/ingestionState.test.ts`

- [ ] **Step 1: Write the failing status transition test**

```ts
import { describe, expect, it } from "vitest"

import { assertNextIngestionStatus } from "./ingestionState"

describe("assertNextIngestionStatus", () => {
  it("allows submitting -> waiting_provider", () => {
    expect(() => assertNextIngestionStatus("submitting", "waiting_provider")).not.toThrow()
  })

  it("allows processing_provider -> downloading_result", () => {
    expect(() => assertNextIngestionStatus("processing_provider", "downloading_result")).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the state test to verify it fails**

Run: `bun test convex/lib/ingestionState.test.ts`
Expected: FAIL because the new statuses do not exist yet.

- [ ] **Step 3: Update validators and state machine**

```ts
export const ingestionStatusValidator = v.union(
  v.literal("queued"),
  v.literal("downloading"),
  v.literal("submitting"),
  v.literal("waiting_provider"),
  v.literal("processing_provider"),
  v.literal("downloading_result"),
  v.literal("normalizing"),
  v.literal("embedding"),
  v.literal("ready"),
  v.literal("failed")
)

const ALLOWED_NEXT: Record<IngestionStatus, IngestionStatus[]> = {
  queued: ["downloading", "failed"],
  downloading: ["submitting", "failed"],
  submitting: ["waiting_provider", "processing_provider", "failed"],
  waiting_provider: ["processing_provider", "downloading_result", "failed"],
  processing_provider: ["downloading_result", "failed"],
  downloading_result: ["normalizing", "failed"],
  normalizing: ["embedding", "failed"],
  embedding: ["ready", "failed"],
  ready: [],
  failed: ["queued"]
}
```

- [ ] **Step 4: Add provider fields to `ingestionJobs` schema**

```ts
ingestionJobs: defineTable({
  documentId: v.id("documents"),
  requestedBy: v.id("users"),
  status: ingestionStatusValidator,
  errorMessage: v.optional(v.string()),
  provider: v.optional(v.literal("mineru")),
  providerBatchId: v.optional(v.string()),
  providerDataId: v.optional(v.string()),
  providerErrorCode: v.optional(v.number()),
  providerErrorMessage: v.optional(v.string()),
  providerResultUrl: v.optional(v.string()),
  providerState: v.optional(v.string()),
  providerTraceId: v.optional(v.string()),
  providerSubmittedAt: v.optional(v.number()),
  providerLastCheckedAt: v.optional(v.number()),
  providerCallbackVerifiedAt: v.optional(v.number()),
  priorityQuotaBucket: v.optional(v.union(v.literal("priority_expected"), v.literal("standard_possible"), v.literal("unknown"))),
  createdAt: v.number(),
  updatedAt: v.number()
}).index("by_document", ["documentId"])
```

- [ ] **Step 5: Run the state test to verify it passes**

Run: `bun test convex/lib/ingestionState.test.ts`
Expected: PASS

### Task 3: Implement MinerU provider adapter

**Files:**

- Create: `convex/lib/mineruTypes.ts`
- Create: `convex/lib/mineru.ts`
- Test: `convex/lib/mineru.test.ts`

- [ ] **Step 1: Write a failing provider adapter test**

```ts
import { describe, expect, it, vi } from "vitest"

import { submitMineruBatch } from "./mineru"

describe("submitMineruBatch", () => {
  it("creates a batch and uploads exactly one file", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: { batch_id: "batch-1", file_urls: ["https://upload.example/file.pdf"] },
            msg: "ok",
            trace_id: "trace-1"
          })
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const result = await submitMineruBatch({
      fetch,
      file: new Blob(["pdf"]),
      fileName: "manual.pdf",
      token: "token"
    })

    expect(result).toEqual({ batchId: "batch-1", traceId: "trace-1" })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the provider test to verify it fails**

Run: `bun test convex/lib/mineru.test.ts`
Expected: FAIL because the adapter files do not exist.

- [ ] **Step 3: Add typed MinerU submit and status helpers**

```ts
export async function submitMineruBatch(args: {
  fetch?: typeof fetch
  file: Blob
  fileName: string
  token: string
}) {
  const request = args.fetch ?? fetch
  const applyUploadUrl = await request("https://mineru.net/api/v4/file-urls/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      files: [{ name: args.fileName }],
      model_version: "vlm"
    })
  })

  const payload = await applyUploadUrl.json()
  const uploadUrl = payload.data.file_urls[0]
  await request(uploadUrl, {
    method: "PUT",
    body: args.file
  })

  return {
    batchId: payload.data.batch_id,
    traceId: payload.trace_id
  }
}
```

- [ ] **Step 4: Add a batch result helper for reconciliation**

```ts
export async function getMineruBatchResult(args: {
  batchId: string
  fetch?: typeof fetch
  token: string
}) {
  const request = args.fetch ?? fetch
  const response = await request(`https://mineru.net/api/v4/extract-results/batch/${args.batchId}`, {
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json"
    }
  })

  return await response.json()
}
```

- [ ] **Step 5: Run the provider test to verify it passes**

Run: `bun test convex/lib/mineru.test.ts`
Expected: PASS

### Task 4: Add callback verification and reconciliation entrypoints

**Files:**

- Modify: `convex/http.ts`
- Create: `convex/lib/mineruCallback.ts`
- Modify: `convex/ingestion.ts`
- Test: `convex/lib/mineruCallback.test.ts`

- [ ] **Step 1: Write the failing callback verification test**

```ts
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { verifyMineruChecksum } from "./mineruCallback"

describe("verifyMineruChecksum", () => {
  it("accepts a valid callback checksum", () => {
    const uid = "user-1"
    const seed = "seed-1"
    const content = JSON.stringify({ batch_id: "batch-1" })
    const checksum = createHash("sha256").update(`${uid}${seed}${content}`).digest("hex")

    expect(verifyMineruChecksum({ checksum, content, seed, uid })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the callback test to verify it fails**

Run: `bun test convex/lib/mineruCallback.test.ts`
Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Add callback verification and parsing helpers**

```ts
import { createHash } from "node:crypto"

export function verifyMineruChecksum(args: {
  checksum: string
  content: string
  seed: string
  uid: string
}) {
  const expected = createHash("sha256").update(`${args.uid}${args.seed}${args.content}`).digest("hex")
  return expected === args.checksum
}
```

- [ ] **Step 4: Register a Convex HTTP route for MinerU callback delivery**

```ts
import { httpRouter } from "convex/server"

import { auth } from "./auth"
import { mineruCallback } from "./ingestion"

const http = httpRouter()

auth.addHttpRoutes(http)
http.route({
  path: "/providers/mineru/callback",
  method: "POST",
  handler: mineruCallback
})

export default http
```

- [ ] **Step 5: Add a reconciliation action entrypoint in `convex/ingestion.ts`**

```ts
export const reconcileProviderJob = internalAction({
  args: { jobId: v.id("ingestionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // load job
    // query MinerU batch result
    // move the job to waiting_provider, processing_provider,
    // downloading_result, or failed
    return null
  }
})
```

- [ ] **Step 6: Run the callback test to verify it passes**

Run: `bun test convex/lib/mineruCallback.test.ts`
Expected: PASS

### Task 5: Normalize MinerU structured JSON instead of splitting markdown

**Files:**

- Create: `convex/lib/mineruResult.ts`
- Modify: `convex/lib/normalize.ts`
- Test: `convex/lib/normalize.test.ts`

- [ ] **Step 1: Write the failing normalization test using the provided sample shape**

```ts
import { describe, expect, it } from "vitest"

import { normalizeMineruDocument } from "./mineruResult"

describe("normalizeMineruDocument", () => {
  it("converts MinerU pages into page-local markdown and structured chunks", () => {
    const result = normalizeMineruDocument({
      pdf_info: [
        {
          page_idx: 1,
          page_size: [612, 792],
          discarded_blocks: [],
          para_blocks: [
            {
              type: "title",
              bbox: [0, 0, 0, 0],
              lines: [{ bbox: [0, 0, 0, 0], spans: [{ type: "text", content: "Important User Information", bbox: [0, 0, 0, 0] }] }]
            },
            {
              type: "table",
              bbox: [0, 0, 0, 0],
              blocks: [{
                bbox: [0, 0, 0, 0],
                type: "table_body",
                lines: [{ bbox: [0, 0, 0, 0], spans: [{ type: "table", html: "<table><tr><td>IMPORTANT</td></tr></table>", bbox: [0, 0, 0, 0] }] }]
              }]
            }
          ]
        }
      ]
    })

    expect(result.pages[0]?.pageNumber).toBe(2)
    expect(result.pages[0]?.markdown).toContain("# Important User Information")
    expect(result.chunks.some((chunk) => chunk.chunkType === "table")).toBe(true)
  })
})
```

- [ ] **Step 2: Run the normalization test to verify it fails**

Run: `bun test convex/lib/normalize.test.ts`
Expected: FAIL because MinerU JSON normalization does not exist.

- [ ] **Step 3: Add structured result helpers instead of markdown-only splitting**

```ts
function extractSpanText(block: { lines?: Array<{ spans?: Array<{ content?: string }> }> }) {
  return (block.lines ?? [])
    .flatMap((line) => line.spans ?? [])
    .map((span) => span.content?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
}

function renderPageMarkdown(blocks: NormalizedMineruBlock[]) {
  return blocks
    .map((block) => {
      if (block.kind === "title") return `# ${block.text}`
      if (block.kind === "table") return block.html
      if (block.kind === "image") return `![image](${block.url})`
      return block.text
    })
    .filter(Boolean)
    .join("\n\n")
}
```

- [ ] **Step 4: Build block-aware chunks**

```ts
function toChunkType(block: NormalizedMineruBlock): ChunkType {
  if (block.kind === "table") return "table"
  if (/warning|attention|important|shock hazard|arc flash/i.test(block.text ?? block.html ?? "")) return "warning"
  if (/catalog|module|connector|terminal|specification/i.test(block.text ?? "")) return "spec"
  if (/figure|diagram|wiring|chassis|slot/i.test(block.text ?? "")) return "diagram_description"
  return "text"
}
```

- [ ] **Step 5: Run the normalization test to verify it passes**

Run: `bun test convex/lib/normalize.test.ts`
Expected: PASS

### Task 6: Refactor ingestion orchestration to MinerU async flow

**Files:**

- Modify: `convex/lib/ingestDocument.ts`
- Modify: `convex/ingestion.ts`
- Modify: `convex/documents.ts`
- Test: `convex/lib/ingestDocument.test.ts`

- [ ] **Step 1: Write a failing orchestration test**

```ts
import { describe, expect, it, vi } from "vitest"

import { buildDocumentPayload } from "./ingestDocument"

describe("buildDocumentPayload", () => {
  it("accepts already-normalized provider pages and does not invoke OCR", async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]])

    const payload = await buildDocumentPayload({
      embed,
      parsedPages: [{ markdown: "# Title\n\nBody", pageNumber: 1 }]
    })

    expect(embed).toHaveBeenCalledTimes(1)
    expect(payload.pages[0]?.pageNumber).toBe(1)
  })
})
```

- [ ] **Step 2: Run the orchestration test to verify it fails**

Run: `bun test convex/lib/ingestDocument.test.ts`
Expected: FAIL because `buildDocumentPayload` still expects parse and OCR callbacks.

- [ ] **Step 3: Simplify `buildDocumentPayload` to accept parsed pages directly**

```ts
type BuildDocumentPayloadArgs = {
  embed: (inputs: string[]) => Promise<number[][]>
  parsedPages: ParsedPage[]
}

export async function buildDocumentPayload(args: BuildDocumentPayloadArgs) {
  const normalized = normalizeParsedPages(args.parsedPages)
  const embeddings = normalized.chunks.length === 0 ? [] : await args.embed(normalized.chunks.map((chunk) => chunk.content))

  if (embeddings.length !== normalized.chunks.length) {
    throw new Error("Embedding count does not match chunk count")
  }

  return {
    chunks: normalized.chunks,
    embeddings,
    pages: normalized.pages
  }
}
```

- [ ] **Step 4: Refactor `runDocumentJob` into submit and finalize phases**

```ts
await ctx.runMutation(internal.ingestion.updateJobStatus, {
  jobId: args.jobId,
  status: "submitting"
})

const providerSubmission = await submitMineruBatch({
  file: sourceBlob,
  fileName: sourceFileName,
  token: getProviderEnv().mineruApiToken
})

await ctx.runMutation(internal.ingestion.recordProviderSubmission, {
  jobId: args.jobId,
  provider: "mineru",
  providerBatchId: providerSubmission.batchId,
  providerState: "pending",
  providerTraceId: providerSubmission.traceId
})

await ctx.scheduler.runAfter(5_000, internal.ingestion.reconcileProviderJob, { jobId: args.jobId })
```

- [ ] **Step 5: Add a finalization action that downloads the provider result and persists parsed content**

```ts
export const finalizeProviderResult = internalAction({
  args: { documentId: v.id("documents"), jobId: v.id("ingestionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // load job and result URL
    // download zip
    // extract middle.json
    // normalize into ParsedPage[]
    // buildDocumentPayload
    // persist via replaceParsedContent
    return null
  }
})
```

- [ ] **Step 6: Run the orchestration test to verify it passes**

Run: `bun test convex/lib/ingestDocument.test.ts`
Expected: PASS

### Task 7: Preserve RAG behavior while keeping images viewer-only

**Files:**

- Modify: `convex/lib/answerPacket.ts`
- Modify: `convex/search.ts`
- Modify: `src/features/view-evidence/ui/EvidenceViewer.tsx`
- Test: `convex/lib/answerPacket.test.ts`

- [ ] **Step 1: Write a failing answer packet test documenting the v1 image policy**

```ts
import { describe, expect, it } from "vitest"

import { buildGroundedPacket } from "./answerPacket"

describe("buildGroundedPacket", () => {
  it("keeps supporting assets page-based so the PDF viewer remains the primary evidence surface", () => {
    const packet = buildGroundedPacket("chatSessions_1" as never, "summary", ["step"], [
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 15",
        chunkId: "chunks_1" as never,
        pageNumber: 15,
        score: 0.9
      }
    ])

    expect(packet.supportingAssets).toEqual([{ assetId: "documentAssets_1", label: "Page 15", pageNumber: 15 }])
  })
})
```

- [ ] **Step 2: Run the answer packet test to verify current behavior still passes**

Run: `bun test convex/lib/answerPacket.test.ts`
Expected: PASS

- [ ] **Step 3: Add a code comment documenting the image-evidence decision**

```ts
// v1 keeps evidence page-based: citations open the source PDF page instead of
// rendering extracted MinerU image assets inline in the answer packet.
```

- [ ] **Step 4: Update viewer copy to make page-based image evidence explicit**

```tsx
<p className="text-sm leading-6 text-slate-400">
  Open the cited source PDF page to inspect the supporting text, table, or diagram evidence.
</p>
```

- [ ] **Step 5: Re-run the answer packet test**

Run: `bun test convex/lib/answerPacket.test.ts`
Expected: PASS

### Task 8: Update admin UI for external provider states

**Files:**

- Modify: `src/features/admin-ingestion/ui/IngestionJobList.tsx`
- Modify: `convex/ingestion.ts`
- Test: `src/features/admin-ingestion/ui/IngestionJobList.test.tsx`

- [ ] **Step 1: Write the failing UI test**

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import IngestionJobList from "./IngestionJobList"

describe("IngestionJobList", () => {
  it("renders waiting provider copy for async MinerU jobs", () => {
    render(
      <IngestionJobList
        jobs={[{ _id: "ingestionJobs_1" as never, documentId: "documents_1" as never, status: "waiting_provider" }]}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText(/waiting on mineru queue/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run: `bun test src/features/admin-ingestion/ui/IngestionJobList.test.tsx`
Expected: FAIL because the component only prints raw status text.

- [ ] **Step 3: Add a status label mapper for provider-oriented copy**

```ts
function statusLabel(status: string) {
  if (status === "waiting_provider") return "Waiting on MinerU queue"
  if (status === "processing_provider") return "MinerU is processing"
  if (status === "downloading_result") return "Importing MinerU result"
  return status
}
```

- [ ] **Step 4: Re-run the UI test to verify it passes**

Run: `bun test src/features/admin-ingestion/ui/IngestionJobList.test.tsx`
Expected: PASS

### Task 9: Add result fixtures and normalization coverage from the provided sample

**Files:**

- Create: `convex/lib/__fixtures__/mineru_guardlogix_middle.json`
- Create: `convex/lib/__fixtures__/mineru_guardlogix_full.md`
- Modify: `convex/lib/normalize.test.ts`
- Modify: `convex/lib/mineruResult.test.ts`

- [ ] **Step 1: Add the provided MinerU sample outputs as test fixtures**

```text
convex/lib/__fixtures__/mineru_guardlogix_middle.json
convex/lib/__fixtures__/mineru_guardlogix_full.md
```

- [ ] **Step 2: Add a fixture-driven normalization test**

```ts
import middleFixture from "./__fixtures__/mineru_guardlogix_middle.json"

it("drops discarded headers and keeps table html from the real sample fixture", () => {
  const result = normalizeMineruDocument(middleFixture)

  expect(result.pages[0]?.markdown).toContain("# GuardLogix 5570 Controllers")
  expect(result.pages[0]?.markdown).not.toContain("User Manual")
  expect(result.chunks.some((chunk) => chunk.content.includes("<table>"))).toBe(true)
})
```

- [ ] **Step 3: Run the fixture-driven tests**

Run: `bun test convex/lib/normalize.test.ts convex/lib/mineruResult.test.ts`
Expected: PASS

### Task 10: Verify the full migration surface

**Files:**

- Modify: `docs/testing/sp1-manual-qa.md`

- [ ] **Step 1: Update manual QA to reflect async provider states**

```md
3. Confirm the ingestion job transitions through `submitting`, `waiting_provider` or `processing_provider`, and finally `ready`.
4. If the provider queue is slow, confirm the admin UI continues to show the waiting state instead of appearing stuck.
```

- [ ] **Step 2: Run targeted tests for all touched ingestion modules**

Run: `bun test convex/lib/env.test.ts convex/lib/ingestionState.test.ts convex/lib/mineru.test.ts convex/lib/mineruCallback.test.ts convex/lib/normalize.test.ts convex/lib/ingestDocument.test.ts convex/lib/answerPacket.test.ts src/features/admin-ingestion/ui/IngestionJobList.test.tsx`
Expected: PASS

- [ ] **Step 3: Run required repo verification**

Run: `bun run lint`
Expected: PASS with zero Biome, type-check, and Convex type errors.

- [ ] **Step 4: Manual QA the GuardLogix sample workflow**

Run:

1. Sign in as admin.
2. Queue the GuardLogix manual.
3. Confirm the job reaches `ready` after MinerU completes.
4. Ask an evidence-heavy question such as `Where should the 1756-L7SP safety partner be installed relative to the primary controller?`
5. Click the citation and verify the PDF viewer opens the cited page with the diagram or text evidence.

Expected: PASS
