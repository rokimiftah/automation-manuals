# Jina and Mercury Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all runtime Mistral usage and migrate embeddings to Jina `jina-embeddings-v5-text-small` plus grounded answer generation to Inception Labs `mercury-2`, with durable multi-key handling for provider rate limits.

**Architecture:** Replace the combined Mistral adapter with focused provider modules for Jina and Inception. Add a Convex-backed provider key pool that stores only non-secret key ids, tracks per-key cooldown and usage windows, and lets actions reserve capacity atomically before external calls. Make document embeddings durable by staging parsed content first, processing chunk embedding batches through scheduled actions, and resuming automatically after `429` without failing the document.

**Tech Stack:** Convex 1.x, TypeScript 6, Bun, Vitest, Jina Embeddings API, Inception Labs Mercury 2 Chat Completions API, MinerU.

**Commit Policy:** This repo forbids automatic commits. Implementation workers must ask the project owner before committing, even when a task is complete.

---

## File Structure

- Create `convex/lib/providerKeys.ts`: parse comma-separated provider key pools, create stable key ids, resolve key ids to raw keys at runtime, and parse per-key safety limits.
- Create `convex/lib/providerKeys.test.ts`: env parsing, stable key ids, empty key rejection, and whitespace trimming tests.
- Create `convex/lib/providerErrors.ts`: typed provider errors for rate limits, quota exhaustion, transient failures, permanent failures, and temporary capacity exhaustion.
- Create `convex/lib/providerErrors.test.ts`: `Retry-After` parsing, sanitized messages, and error classification tests.
- Create `convex/providerRateLimits.ts`: Convex internal mutations for atomic key reservation, success accounting, cooldown, key disabling, and capacity reset.
- Create `convex/providerRateLimits.test.ts`: reservation selection, per-minute windows, cooldown, concurrency, and no-secret persistence tests.
- Create `convex/lib/jina.ts`: Jina embedding constants, request batching by item and estimated tokens, response validation, typed errors, `embedDocumentTexts`, and `embedSearchQuery`.
- Create `convex/lib/jina.test.ts`: Jina request shape, prefixing, batching, key usage, response validation, `429`, and sanitized error tests.
- Create `convex/lib/inception.ts`: Inception Mercury 2 grounded answer request, strict JSON schema, content extraction, parsing, validation, and typed provider errors.
- Create `convex/lib/inception.test.ts`: Mercury request body, structured output parsing, language instruction, `429`, and sanitized error tests.
- Create `convex/embeddingBatches.ts`: durable embedding batch creation, batch processing action, batch state mutations, retry scheduling, and completion finalization.
- Create `convex/embeddingBatches.test.ts`: batch creation, success path, `429` retry, all-key cooldown, quota exhaustion, and duplicate prevention tests.
- Modify `convex/lib/env.ts`: remove Mistral config and add Jina/Inception multi-key config.
- Modify `convex/lib/env.test.ts`: update env expectations and missing-secret tests.
- Modify `convex/schema.ts`: add `providerApiKeyStates`, `embeddingBatches`, required Jina metadata fields on `chunkEmbeddings`, and `embedding_waiting_rate_limit` ingestion status support.
- Modify `convex/lib/validators.ts`: add `embedding_waiting_rate_limit` to `ingestionStatusValidator`.
- Modify `convex/lib/ingestionState.ts`: allow `embedding -> embedding_waiting_rate_limit -> embedding` and `embedding_waiting_rate_limit -> failed` transitions.
- Modify `convex/documents.ts`: split parsed-content staging from embedding insertion, keep source asset/page/chunk replacement, and insert chunk embeddings by durable batch.
- Modify `convex/documents.test.ts`: expect staged chunks and Jina metadata in inserted embeddings.
- Modify `convex/lib/ingestDocument.ts`: expose a normalization-only helper for MinerU parsed pages so finalization can stage content before embeddings exist.
- Modify `convex/lib/ingestDocument.test.ts`: verify the normalization-only helper returns pages and chunks without calling an embedding provider.
- Modify `convex/ingestionNode.ts`: replace Mistral embedding/OCR imports, remove OCR fallback wiring, stage parsed content, and enqueue durable embedding batches.
- Modify `convex/ingestionNode.test.ts`: assert finalization stages content, does not call OCR fallback, and schedules embedding batches.
- Modify `convex/search.ts`: replace Mistral imports with Jina query embeddings and Inception grounded answers, using provider capacity errors for all-key cooldown.
- Modify `convex/search.ask.test.ts`: mock new provider modules and preserve existing search behavior tests.
- Delete `convex/lib/mistral.ts` and `convex/lib/mistral.test.ts` after replacements pass.
- Modify `package.json` and `bun.lock`: remove `@mistralai/mistralai`.
- Modify `.env.local.example`: remove Mistral env and document multi-key Jina/Inception env.
- Create `docs/testing/jina-mercury-provider-migration.md`: manual rollout, database reset, multi-key configuration, rate-limit recovery, smoke tests, and rollback notes.

---

### Task 1: Replace Provider Environment Configuration

**Files:**

- Modify: `convex/lib/env.ts`
- Modify: `convex/lib/env.test.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Write failing env tests**

Add or replace tests in `convex/lib/env.test.ts` so the successful config uses plural provider keys:

```ts
expect(
  getProviderEnv({
    INCEPTION_API_KEYS: " inception-key-1, inception-key-2 ",
    INCEPTION_BASE_URL: " https://api.inceptionlabs.ai/v1 ",
    INCEPTION_CHAT_MODEL: " mercury-2 ",
    INCEPTION_INPUT_TPM_PER_KEY: " 90000 ",
    INCEPTION_MAX_CONCURRENT_PER_KEY: " 1 ",
    INCEPTION_MAX_TOKENS: " 8192 ",
    INCEPTION_OUTPUT_TPM_PER_KEY: " 8000 ",
    INCEPTION_REASONING_EFFORT: " medium ",
    INCEPTION_RPM_PER_KEY: " 90 ",
    INCEPTION_TEMPERATURE: " 0.75 ",
    JINA_API_KEYS: " jina-key-1, jina-key-2 ",
    JINA_EMBED_MODEL: " jina-embeddings-v5-text-small ",
    JINA_MAX_CONCURRENT_PER_KEY: " 2 ",
    JINA_RPM_PER_KEY: " 90 ",
    JINA_TPM_PER_KEY: " 90000 ",
    MINERU_API_TOKEN: " mineru-token "
  })
).toMatchObject({
  inceptionApiKeys: ["inception-key-1", "inception-key-2"],
  inceptionBaseUrl: "https://api.inceptionlabs.ai/v1",
  inceptionChatModel: "mercury-2",
  inceptionInputTpmPerKey: 90000,
  inceptionMaxConcurrentPerKey: 1,
  inceptionMaxTokens: 8192,
  inceptionOutputTpmPerKey: 8000,
  inceptionReasoningEffort: "medium",
  inceptionRpmPerKey: 90,
  inceptionTemperature: 0.75,
  jinaApiKeys: ["jina-key-1", "jina-key-2"],
  jinaEmbedModel: "jina-embeddings-v5-text-small",
  jinaMaxConcurrentPerKey: 2,
  jinaRpmPerKey: 90,
  jinaTpmPerKey: 90000,
  mineruApiToken: "mineru-token"
})
```

Add missing-secret assertions:

```ts
expect(() => getProviderEnv({ MINERU_API_TOKEN: "mineru", INCEPTION_API_KEYS: "inception" })).toThrow("JINA_API_KEYS is required")
expect(() => getProviderEnv({ MINERU_API_TOKEN: "mineru", JINA_API_KEYS: "jina" })).toThrow("INCEPTION_API_KEYS is required")
```

- [ ] **Step 2: Run env tests to verify failure**

Run: `bun test convex/lib/env.test.ts`

Expected: FAIL because `getProviderEnv` still requires `MISTRAL_API_KEY` and does not expose multi-key provider fields.

- [ ] **Step 3: Implement env parsing**

Modify `convex/lib/env.ts`:

- Remove `MISTRAL_API_KEY`, `MISTRAL_CHAT_MODEL`, and `MISTRAL_EMBED_MODEL` from `ProviderEnvInput`.
- Remove `mistralApiKey`, `mistralChatModel`, and `mistralEmbedModel` from `ProviderEnv`.
- Add `jinaApiKeys: string[]` and `inceptionApiKeys: string[]`.
- Add defaults for `jinaEmbedModel`, `jinaRpmPerKey`, `jinaTpmPerKey`, `jinaMaxConcurrentPerKey`, `inceptionBaseUrl`, `inceptionChatModel`, `inceptionMaxTokens`, `inceptionReasoningEffort`, `inceptionTemperature`, `inceptionRpmPerKey`, `inceptionInputTpmPerKey`, `inceptionOutputTpmPerKey`, and `inceptionMaxConcurrentPerKey`.
- Parse comma-separated key lists by trimming values and filtering blanks.
- Reject empty parsed key lists with `JINA_API_KEYS is required` and `INCEPTION_API_KEYS is required`.
- Validate `inceptionReasoningEffort` to one of `instant`, `low`, `medium`, `high`; fallback to `medium` for invalid values.
- Clamp or fallback `INCEPTION_TEMPERATURE` to `0.75` when outside `0.5` to `1.0`.

- [ ] **Step 4: Run env tests to verify pass**

Run: `bun test convex/lib/env.test.ts`

Expected: PASS.

- [ ] **Step 5: Update `.env.local.example`**

Replace the Mistral section with Jina and Inception sections:

```env
# Required. Comma-separated Jina keys used for text embeddings.
JINA_API_KEYS=

# Optional. Defaults to `jina-embeddings-v5-text-small`.
JINA_EMBED_MODEL=jina-embeddings-v5-text-small

# Optional safety limits per Jina key. Keep below provider hard limits.
JINA_RPM_PER_KEY=90
JINA_TPM_PER_KEY=90000
JINA_MAX_CONCURRENT_PER_KEY=2

# Required. Comma-separated Inception keys used for grounded answer generation.
INCEPTION_API_KEYS=

# Optional. Defaults to `https://api.inceptionlabs.ai/v1`.
INCEPTION_BASE_URL=https://api.inceptionlabs.ai/v1

# Optional. Defaults to `mercury-2`.
INCEPTION_CHAT_MODEL=mercury-2

# Optional. Defaults to `medium`.
INCEPTION_REASONING_EFFORT=medium

# Optional. Defaults to `8192`.
INCEPTION_MAX_TOKENS=8192

# Optional. Defaults to `0.75`.
INCEPTION_TEMPERATURE=0.75

# Optional safety limits per Inception key. Keep below provider hard limits.
INCEPTION_RPM_PER_KEY=90
INCEPTION_INPUT_TPM_PER_KEY=90000
INCEPTION_OUTPUT_TPM_PER_KEY=9000
INCEPTION_MAX_CONCURRENT_PER_KEY=1
```

---

### Task 2: Add Provider Key Pool Utilities

**Files:**

- Create: `convex/lib/providerKeys.ts`
- Create: `convex/lib/providerKeys.test.ts`

- [ ] **Step 1: Write failing key utility tests**

Create `convex/lib/providerKeys.test.ts` with tests covering:

```ts
expect(buildProviderKeyPool("jina", [" key-a ", "key-b"])).toEqual([
  { id: "jina:1", secret: "key-a" },
  { id: "jina:2", secret: "key-b" }
])

expect(() => buildProviderKeyPool("inception", [])).toThrow("INCEPTION_API_KEYS is required")
expect(resolveProviderKey(buildProviderKeyPool("jina", ["key-a"]), "jina:1")).toBe("key-a")
expect(() => resolveProviderKey(buildProviderKeyPool("jina", ["key-a"]), "jina:2")).toThrow(
  "Provider key jina:2 is not configured"
)
```

- [ ] **Step 2: Run key utility tests to verify failure**

Run: `bun test convex/lib/providerKeys.test.ts`

Expected: FAIL because `convex/lib/providerKeys.ts` does not exist.

- [ ] **Step 3: Implement key utilities**

Create `convex/lib/providerKeys.ts` with:

```ts
export type ProviderName = "jina" | "inception"

export type ProviderKey = {
  id: string
  secret: string
}

function providerEnvName(provider: ProviderName) {
  return provider === "jina" ? "JINA_API_KEYS" : "INCEPTION_API_KEYS"
}

export function buildProviderKeyPool(provider: ProviderName, rawKeys: string[]) {
  const keys = rawKeys.map((key) => key.trim()).filter(Boolean)
  if (keys.length === 0) {
    throw new Error(`${providerEnvName(provider)} is required`)
  }

  return keys.map((secret, index) => ({
    id: `${provider}:${index + 1}`,
    secret
  })) satisfies ProviderKey[]
}

export function resolveProviderKey(pool: ProviderKey[], keyId: string) {
  const key = pool.find((item) => item.id === keyId)
  if (!key) {
    throw new Error(`Provider key ${keyId} is not configured`)
  }

  return key.secret
}
```

- [ ] **Step 4: Run key utility tests to verify pass**

Run: `bun test convex/lib/providerKeys.test.ts`

Expected: PASS.

---

### Task 3: Add Typed Provider Errors

**Files:**

- Create: `convex/lib/providerErrors.ts`
- Create: `convex/lib/providerErrors.test.ts`

- [ ] **Step 1: Write failing provider error tests**

Create `convex/lib/providerErrors.test.ts` with tests covering:

```ts
expect(parseRetryAfterMs("3", 1_000)).toBe(3_000)
expect(parseRetryAfterMs(new Date(11_000).toUTCString(), 1_000)).toBe(10_000)
expect(parseRetryAfterMs(undefined, 1_000)).toBeUndefined()

const error = new ProviderRateLimitError({ keyId: "jina:1", provider: "jina", retryAfterMs: 60_000 })
expect(error.retryAfterMs).toBe(60_000)
expect(error.message).toBe("jina provider key jina:1 is rate limited")
```

- [ ] **Step 2: Run provider error tests to verify failure**

Run: `bun test convex/lib/providerErrors.test.ts`

Expected: FAIL because `convex/lib/providerErrors.ts` does not exist.

- [ ] **Step 3: Implement typed provider errors**

Create `convex/lib/providerErrors.ts` with exported classes:

- `ProviderRateLimitError` with `provider`, `keyId`, and `retryAfterMs`.
- `ProviderQuotaExhaustedError` with `provider` and `keyId`.
- `ProviderTransientError` with `provider`, optional `keyId`, and sanitized message.
- `ProviderPermanentError` with `provider`, optional `keyId`, and sanitized message.
- `ProviderCapacityError` with `provider` and `retryAfterMs` for all-key cooldown.
- `parseRetryAfterMs(value, now)` supporting seconds and HTTP date headers.

Ensure messages never include API keys, input text, raw provider response bodies, questions, or document chunks.

- [ ] **Step 4: Run provider error tests to verify pass**

Run: `bun test convex/lib/providerErrors.test.ts`

Expected: PASS.

---

### Task 4: Add Provider Rate Limit State

**Files:**

- Modify: `convex/schema.ts`
- Create: `convex/providerRateLimits.ts`
- Create: `convex/providerRateLimits.test.ts`

- [ ] **Step 1: Write failing rate limit tests**

Create `convex/providerRateLimits.test.ts` with tests covering:

- Reserving capacity for `jina` with two key ids returns the first non-disabled, non-cooling key.
- A key with `cooldownUntil` greater than `Date.now()` is skipped.
- A key at `requestCount >= rpmLimit` is skipped until the next minute window.
- A key at `inputTokenCount + estimatedInputTokens > inputTpmLimit` is skipped.
- A key at `inFlightCount >= maxConcurrent` is skipped.
- If all keys are skipped, return `{ available: false, retryAfterMs }` using the earliest cooldown or next window.
- `recordProviderSuccess` decrements `inFlightCount` and applies actual usage if provided.
- `recordProviderRateLimit` sets `cooldownUntil`, `lastRateLimitedAt`, and decrements `inFlightCount`.
- Raw API key strings such as `jina-key-1` never appear in inserted or patched rows.

- [ ] **Step 2: Run rate limit tests to verify failure**

Run: `bun test convex/providerRateLimits.test.ts`

Expected: FAIL because `convex/providerRateLimits.ts` and schema fields do not exist.

- [ ] **Step 3: Update schema**

Modify `convex/schema.ts` to add:

```ts
providerApiKeyStates: defineTable({
  provider: v.union(v.literal("jina"), v.literal("inception")),
  keyId: v.string(),
  windowStart: v.number(),
  requestCount: v.number(),
  inputTokenCount: v.number(),
  outputTokenCount: v.number(),
  inFlightCount: v.number(),
  cooldownUntil: v.optional(v.number()),
  disabledAt: v.optional(v.number()),
  disabledReason: v.optional(v.string()),
  lastRateLimitedAt: v.optional(v.number()),
  updatedAt: v.number()
})
  .index("by_provider", ["provider"])
  .index("by_provider_and_key", ["provider", "keyId"])
```

- [ ] **Step 4: Implement provider rate limit mutations**

Create `convex/providerRateLimits.ts` with internal mutations:

- `reserveProviderKey({ provider, keyIds, estimatedInputTokens, estimatedOutputTokens, rpmLimit, inputTpmLimit, outputTpmLimit, maxConcurrent })` returns either `{ available: true, keyId }` or `{ available: false, retryAfterMs }`.
- `recordProviderSuccess({ provider, keyId, inputTokens, outputTokens })` releases in-flight count.
- `recordProviderRateLimit({ provider, keyId, retryAfterMs })` releases in-flight count and records cooldown.
- `recordProviderTransientFailure({ provider, keyId })` releases in-flight count without disabling the key.
- `disableProviderKey({ provider, keyId, reason })` releases in-flight count and sets `disabledAt` and `disabledReason`.
- `resetProviderKeyState({ provider, keyId })` clears cooldown and disabled state for operator recovery.

- [ ] **Step 5: Run rate limit tests to verify pass**

Run: `bun test convex/providerRateLimits.test.ts`

Expected: PASS.

---

### Task 5: Add Jina Embedding Provider

**Files:**

- Create: `convex/lib/jina.ts`
- Create: `convex/lib/jina.test.ts`

- [ ] **Step 1: Write failing Jina tests**

Create `convex/lib/jina.test.ts` with tests covering:

- `embedDocumentTexts(["chunk"], { apiKey: "key", fetchImpl })` sends `task: "retrieval.passage"`.
- `embedSearchQuery("question", { apiKey: "key", fetchImpl })` sends `task: "retrieval.query"`.
- Document embedding requests send `input: ["Document: chunk"]`.
- Query embedding requests send `input: ["Query: question"]`.
- Headers include `Authorization: Bearer key`, `Content-Type: application/json`, and `Accept: application/json`.
- Request body includes `model`, `normalized: true`, `embedding_type: "float"`, `dimensions: 1024`, and `truncate: false`.
- Empty document input returns `[]` and does not call `fetchImpl`.
- Batch size splits by item count and by estimated token ceiling.
- Provider response ordering uses each item `index` when present.
- A returned embedding with length other than 1024 throws `Jina embedding response returned 2 dimensions; expected 1024`.
- HTTP `429` throws `ProviderRateLimitError` and uses `Retry-After` when present.
- HTTP `401` throws `ProviderPermanentError` or `ProviderQuotaExhaustedError` based on the sanitized provider error code.
- HTTP `5xx` throws `ProviderTransientError` without input text or API keys.

- [ ] **Step 2: Run Jina tests to verify failure**

Run: `bun test convex/lib/jina.test.ts`

Expected: FAIL because `convex/lib/jina.ts` does not exist.

- [ ] **Step 3: Implement Jina provider**

Create `convex/lib/jina.ts` with:

- `JINA_EMBEDDING_DIMENSIONS = 1024`.
- `JINA_DOCUMENT_TASK = "retrieval.passage"`.
- `JINA_QUERY_TASK = "retrieval.query"`.
- `JINA_EMBEDDING_PROVIDER = "jina"`.
- `JINA_DOCUMENT_PREFIX = "Document: "`.
- `JINA_QUERY_PREFIX = "Query: "`.
- `embedDocumentTexts(inputs, options)`.
- `embedSearchQuery(question, options)`.
- Shared batching and validation helpers.
- `fetchImpl`, `apiKey`, `model`, `maxItemsPerBatch`, and `maxEstimatedTokensPerBatch` options for tests and worker integration.
- No logging of input text, API keys, or raw provider response bodies.

The request URL should be exactly `https://api.jina.ai/v1/embeddings`.

- [ ] **Step 4: Run Jina tests to verify pass**

Run: `bun test convex/lib/jina.test.ts`

Expected: PASS.

---

### Task 6: Add Inception Mercury 2 Provider

**Files:**

- Create: `convex/lib/inception.ts`
- Create: `convex/lib/inception.test.ts`

- [ ] **Step 1: Write failing Inception tests**

Create `convex/lib/inception.test.ts` with tests covering:

- `generateGroundedAnswer` posts to `https://api.inceptionlabs.ai/v1/chat/completions` by default.
- Headers include `Authorization: Bearer key` and `Content-Type: application/json`.
- Request uses `model: "mercury-2"`, `stream: false`, `reasoning_effort: "medium"`, `reasoning_summary: false`, `temperature: 0.75`, and `max_tokens: 8192`.
- Request uses `response_format.type: "json_schema"` and a strict schema requiring `answerSummary`, `answerSteps`, and `citationIds`.
- System prompt includes the provided `QuestionLanguage.instruction`.
- JSON string response parses to `{ answerSummary, answerSteps, citationIds }`.
- Structured content arrays are joined before JSON parsing.
- HTTP `429` throws `ProviderRateLimitError` and uses `Retry-After` when present.
- Missing or malformed JSON throws a sanitized `ProviderPermanentError`.
- HTTP errors do not include API key, question, or context.

- [ ] **Step 2: Run Inception tests to verify failure**

Run: `bun test convex/lib/inception.test.ts`

Expected: FAIL because `convex/lib/inception.ts` does not exist.

- [ ] **Step 3: Implement Inception provider**

Create `convex/lib/inception.ts` with:

- `extractTextContent(content: unknown)` moved from the old Mistral adapter.
- `generateGroundedAnswer(question, context, language, options)`.
- A strict JSON schema named `GroundedAnswer`.
- A parser that returns only string `answerSummary`, string array `answerSteps`, and string array `citationIds`.
- Typed provider errors from `convex/lib/providerErrors.ts`.
- `fetchImpl`, `apiKey`, `baseUrl`, and `model` options for tests.

- [ ] **Step 4: Run Inception tests to verify pass**

Run: `bun test convex/lib/inception.test.ts`

Expected: PASS.

---

### Task 7: Add Staged Documents and Embedding Batch Schema

**Files:**

- Modify: `convex/schema.ts`
- Modify: `convex/lib/validators.ts`
- Modify: `convex/lib/ingestionState.ts`
- Modify: `convex/documents.ts`
- Modify: `convex/documents.test.ts`

- [ ] **Step 1: Write failing document staging tests**

In `convex/documents.test.ts`, add tests that call the new staged-content mutation and assert:

- Current source asset, pages, chunks, and embeddings are superseded or deleted before new staged content is inserted.
- New pages and chunks are inserted without requiring embeddings in the same mutation.
- The document status becomes `processing`.
- `insertChunkEmbeddingsBatch` inserts embeddings with `embeddingProvider: "jina"`, `embeddingModel`, `embeddingTask: "retrieval.passage"`, and `embeddingDimensions: 1024`.
- Calling `insertChunkEmbeddingsBatch` twice for the same chunk ids does not create duplicate embeddings.

- [ ] **Step 2: Run document tests to verify failure**

Run: `bun test convex/documents.test.ts`

Expected: FAIL because staged document functions and schema fields do not exist.

- [ ] **Step 3: Update schema and validators**

Modify `convex/lib/validators.ts` and `convex/lib/ingestionState.ts` to add `embedding_waiting_rate_limit`.

Allowed status transitions must include:

```ts
embedding: ["embedding_waiting_rate_limit", "ready", "failed"],
embedding_waiting_rate_limit: ["embedding", "failed"]
```

Modify `convex/schema.ts` `chunkEmbeddings` table to add:

```ts
embeddingProvider: v.literal("jina"),
embeddingModel: v.string(),
embeddingTask: v.literal("retrieval.passage"),
embeddingDimensions: v.number(),
```

Add `embeddingBatches`:

```ts
embeddingBatches: defineTable({
  jobId: v.id("ingestionJobs"),
  documentId: v.id("documents"),
  batchIndex: v.number(),
  chunkIds: v.array(v.id("chunks")),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("rate_limited"),
    v.literal("retrying"),
    v.literal("completed"),
    v.literal("failed")
  ),
  attemptCount: v.number(),
  nextRunAt: v.optional(v.number()),
  lastErrorMessage: v.optional(v.string()),
  lastProviderKeyId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number()
})
  .index("by_job", ["jobId"])
  .index("by_job_and_status", ["jobId", "status"])
  .index("by_next_run", ["nextRunAt"])
```

- [ ] **Step 4: Implement staged document mutations**

Modify `convex/documents.ts`:

- Add `stageParsedContent` internal mutation that accepts pages, chunks, source asset metadata, document id, and job id; replaces current content; inserts pages/chunks; returns chunk ids in chunk order.
- Add `insertChunkEmbeddingsBatch` internal mutation that accepts chunk ids and embeddings, verifies alignment, skips chunks that already have current embeddings, and inserts only missing embeddings with required Jina metadata.
- Keep `markReady` readiness checks strict so a document cannot become ready until every current chunk has exactly one current embedding.

- [ ] **Step 5: Run document tests to verify pass**

Run: `bun test convex/documents.test.ts`

Expected: PASS.

---

### Task 8: Add Durable Embedding Batch Worker

**Files:**

- Create: `convex/embeddingBatches.ts`
- Create: `convex/embeddingBatches.test.ts`

- [ ] **Step 1: Write failing embedding batch tests**

Create `convex/embeddingBatches.test.ts` with tests covering:

- `createBatchesForJob` splits chunk ids into batches of 50 and inserts `pending` rows.
- `processNextBatch` reserves a Jina key before calling `embedDocumentTexts`.
- Successful batch processing inserts embeddings, records provider success, marks the batch `completed`, and schedules the next pending batch.
- If Jina throws `ProviderRateLimitError`, the worker records key cooldown, marks the batch `rate_limited`, sets `nextRunAt`, updates job status to `embedding_waiting_rate_limit`, and schedules itself after `retryAfterMs`.
- If reservation returns all-key cooldown before an HTTP call, the worker does not call Jina, marks the batch `rate_limited`, and schedules itself after `retryAfterMs`.
- If Jina throws `ProviderQuotaExhaustedError`, the worker disables the key and retries with another key if one is available.
- If all Jina keys are disabled or quota-exhausted, the worker marks the batch `failed` with an operator-actionable message and marks the document failed only after no provider capacity remains.
- Re-processing a completed batch does not insert duplicate embeddings.

- [ ] **Step 2: Run embedding batch tests to verify failure**

Run: `bun test convex/embeddingBatches.test.ts`

Expected: FAIL because `convex/embeddingBatches.ts` does not exist.

- [ ] **Step 3: Implement embedding batch workflow**

Create `convex/embeddingBatches.ts` with:

- `createBatchesForJob` internal mutation.
- `claimNextBatch` internal mutation.
- `markBatchCompleted` internal mutation.
- `markBatchRateLimited` internal mutation.
- `markBatchFailed` internal mutation.
- `completeJobIfAllBatchesDone` internal mutation that schedules exact-term indexing through `internal.search.backfillDocumentExactTermsBatch` after all batches complete.
- `processNextBatch` internal action that loads chunk content, reserves a Jina key, calls `embedDocumentTexts`, records provider state, writes embeddings, and reschedules on retryable capacity errors.

Use `ctx.scheduler.runAfter` for retry delays. Do not rely on Convex automatic action retries for external HTTP calls.

- [ ] **Step 4: Run embedding batch tests to verify pass**

Run: `bun test convex/embeddingBatches.test.ts convex/providerRateLimits.test.ts`

Expected: PASS.

---

### Task 9: Migrate Ingestion Finalization to Durable Jina Batches

**Files:**

- Modify: `convex/ingestionNode.ts`
- Modify: `convex/ingestionNode.test.ts`
- Modify: `convex/lib/ingestDocument.ts`
- Modify: `convex/lib/ingestDocument.test.ts`

- [ ] **Step 1: Write failing ingestion node tests**

In `convex/ingestionNode.test.ts`, mock `./embeddingBatches` and assert finalization:

- Does not import or call `ocrPdfPage`.
- Does not call `ctx.storage.getUrl` for OCR fallback.
- Calls `buildNormalizedDocumentPayload` instead of embedding inside `buildDocumentPayload`.
- Normalizes MinerU output and calls `internal.documents.stageParsedContent`.
- Calls `internal.embeddingBatches.createBatchesForJob` with returned chunk ids.
- Schedules `internal.embeddingBatches.processNextBatch`.
- Does not call `embedDocumentTexts` directly inside `finalizeProviderResult`.

- [ ] **Step 2: Run ingestion node tests to verify failure**

Run: `bun test convex/ingestionNode.test.ts`

Expected: FAIL because `finalizeProviderResult` still imports Mistral helpers and embeds directly.

- [ ] **Step 3: Update `ingestionNode.ts`**

Modify `finalizeProviderResult` so it:

- Removes `embedTexts` and `ocrPdfPage` imports.
- Removes `ctx.storage.getUrl(job.sourceStorageId)` because it was only required for Mistral OCR fallback.
- Adds `buildNormalizedDocumentPayload(parsedPages)` to `convex/lib/ingestDocument.ts`. This helper should normalize parsed pages and return `{ chunks, pages }` without accepting or calling an embedding provider.
- Uses `buildNormalizedDocumentPayload(normalized.pages)` inside `finalizeProviderResult`.
- Calls `internal.documents.stageParsedContent` with pages, chunks, source file metadata, and job id.
- Calls `internal.embeddingBatches.createBatchesForJob` with returned chunk ids.
- Updates job status to `embedding`.
- Schedules `internal.embeddingBatches.processNextBatch` with `runAfter(0, ...)`.

- [ ] **Step 4: Run ingestion tests to verify pass**

Run: `bun test convex/ingestionNode.test.ts convex/lib/ingestDocument.test.ts`

Expected: PASS.

---

### Task 10: Migrate Search to Jina Query Embeddings and Mercury Answers

**Files:**

- Modify: `convex/search.ts`
- Modify: `convex/search.ask.test.ts`

- [ ] **Step 1: Write failing search tests**

In `convex/search.ask.test.ts`:

- Replace the `./lib/mistral` mock with mocks for `./lib/jina`, `./lib/inception`, and provider key reservation helpers.
- Assert rate limit failure in app-level search rate limiting still does not call provider modules or `vectorSearch`.
- Assert successful search calls `embedSearchQuery(question, ...)` using a selected Jina key.
- Assert `vectorSearch` still uses `chunkEmbeddings`, `by_embedding`, existing filters, and the returned query vector.
- Assert grounded answer generation calls the Inception `generateGroundedAnswer(question, context, responseLanguage, ...)` function using a selected Mercury key.
- Assert all-key Mercury cooldown returns a temporary capacity error and does not save a fabricated assistant message.

- [ ] **Step 2: Run search tests to verify failure**

Run: `bun test convex/search.ask.test.ts`

Expected: FAIL because `search.ts` still imports from `./lib/mistral`.

- [ ] **Step 3: Update `search.ts` imports and calls**

Change imports:

```ts
import { generateGroundedAnswer } from "./lib/inception"
import { embedSearchQuery } from "./lib/jina"
```

Add reservation flow for Jina query embedding and Inception answer generation:

- Build key pools from `getProviderEnv()`.
- Estimate input and output tokens before each provider call.
- Reserve provider capacity using `internal.providerRateLimits.reserveProviderKey`.
- Resolve the selected key id to a raw key only inside the action.
- Record success or failure after each provider call.
- Throw or return a temporary provider capacity error when all keys are cooling down.

Keep vector search filters, exact fallback, evidence selection, and answer packet logic unchanged.

- [ ] **Step 4: Run search tests to verify pass**

Run: `bun test convex/search.ask.test.ts convex/search.loadResults.test.ts`

Expected: PASS.

---

### Task 11: Remove Mistral Runtime Code and Dependency

**Files:**

- Delete: `convex/lib/mistral.ts`
- Delete: `convex/lib/mistral.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Verify no runtime imports remain**

Run: `bun test convex/lib/jina.test.ts convex/lib/inception.test.ts convex/search.ask.test.ts convex/ingestionNode.test.ts convex/embeddingBatches.test.ts`

Expected: PASS before deleting Mistral files.

- [ ] **Step 2: Delete old Mistral files**

Delete `convex/lib/mistral.ts` and `convex/lib/mistral.test.ts`.

- [ ] **Step 3: Remove package dependency**

Remove this dependency from `package.json`:

```json
"@mistralai/mistralai": "^2.2.1"
```

Run: `bun install`

Expected: `bun.lock` updates and no install errors.

- [ ] **Step 4: Search for remaining runtime Mistral references**

Use the code search tool or run `rg "@mistralai|MISTRAL_|./lib/mistral|mistral-" convex package.json .env.local.example`.

Expected: no matches in runtime code/config. Historical docs under `docs/superpowers/` may still mention Mistral and should not be rewritten as part of this migration.

---

### Task 12: Update Provider Mocks and Tests Outside the Main Flow

**Files:**

- Modify: `convex/ingestion.test.ts`
- Modify: `convex/adminAudit.test.ts` if env fixture shape changes there
- Modify: any test with `getProviderEnv.mockReturnValue` returning Mistral fields

- [ ] **Step 1: Run affected test slice**

Run: `bun test convex/ingestion.test.ts convex/adminAudit.test.ts convex/lib/env.test.ts`

Expected: FAIL wherever mocks still include `mistralApiKey`, `mistralChatModel`, or `mistralEmbedModel`.

- [ ] **Step 2: Update provider env fixtures**

Replace old fixture fields with:

```ts
inceptionApiKeys: ["inception-test-key-1", "inception-test-key-2"],
inceptionBaseUrl: "https://api.inceptionlabs.ai/v1",
inceptionChatModel: "mercury-2",
inceptionInputTpmPerKey: 90000,
inceptionMaxConcurrentPerKey: 1,
inceptionMaxTokens: 8192,
inceptionOutputTpmPerKey: 9000,
inceptionReasoningEffort: "medium",
inceptionRpmPerKey: 90,
inceptionTemperature: 0.75,
jinaApiKeys: ["jina-test-key-1", "jina-test-key-2"],
jinaEmbedModel: "jina-embeddings-v5-text-small",
jinaMaxConcurrentPerKey: 2,
jinaRpmPerKey: 90,
jinaTpmPerKey: 90000
```

Keep existing MinerU fields unchanged.

- [ ] **Step 3: Re-run affected tests**

Run: `bun test convex/ingestion.test.ts convex/adminAudit.test.ts convex/lib/env.test.ts`

Expected: PASS.

---

### Task 13: Add Migration and Rate-Limit Runbook

**Files:**

- Create: `docs/testing/jina-mercury-provider-migration.md`

- [ ] **Step 1: Write the runbook**

Create a runbook covering:

- Required multi-key env variables.
- Database reset prerequisite.
- Deployment order.
- Jina key limits: 10 keys, 100 RPM, 100000 TPM, 2 concurrent requests per key.
- Mercury key limits: 10 keys, 100 RPM, 100000 input TPM, 10000 output TPM per key.
- Safety margins used by this project.
- What `embedding_waiting_rate_limit` means.
- How to identify provider keys in cooldown without exposing secrets.
- How to rotate keys while preserving key order.
- How to recover from quota exhaustion after topping up or replacing keys.
- Manual ingestion smoke test.
- Search smoke test.
- Expected absence of Mistral in runtime code/config.
- Rollback by reverting code, not runtime provider toggle.
- Evaluation using seeded evaluation cases after re-ingestion.

- [ ] **Step 2: Review for operational gaps**

Verify the runbook explicitly says Mistral OCR fallback is removed, MinerU is the only extraction provider, Jina `429` during embedding is not document failure, and Mercury all-key cooldown should surface a temporary capacity error.

---

### Task 14: Full Verification

**Files:**

- All modified files

- [ ] **Step 1: Run full tests**

Run: `bun run test`

Expected: all tests pass.

- [ ] **Step 2: Run mandatory lint/typecheck**

Run: `bun run lint`

Expected: zero Biome, TypeScript, and Convex TypeScript errors.

- [ ] **Step 3: Final runtime-reference audit**

Run: `rg "@mistralai|MISTRAL_|./lib/mistral|mistral-" convex package.json .env.local.example`

Expected: no runtime/config matches.

- [ ] **Step 4: Confirm no commits were created automatically**

Run: `git status --short`

Expected: only intended working tree changes are present. Do not commit unless the project owner explicitly approves.

---

## Self-Review

- Spec coverage: covers full Mistral removal, Jina embeddings, Mercury answers, OCR fallback removal, multi-key env changes, durable embedding batches, provider cooldown, quota exhaustion, dependency removal, tests, docs, and verification.
- Scope control: no backfill, no mixed-vector support, no reranker, no new OCR provider, no streaming, no new UI dashboard, and no paid-provider auto top-up integration.
- Type consistency: provider names are `jina` and `inception`; models are `jina-embeddings-v5-text-small` and `mercury-2`; embedding tasks are `retrieval.query` and `retrieval.passage`; durable waiting status is `embedding_waiting_rate_limit`.
- Risk check: database reset is a prerequisite because required schema fields are added immediately, and rollback is code-level only.
