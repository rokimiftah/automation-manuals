# Jina and Mercury Provider Migration Design

## Goal

Fully remove Mistral from runtime code and configuration. Use Jina AI
`jina-embeddings-v5-text-small` for all retrieval embeddings and Inception Labs
`mercury-2` for grounded answer generation.

The database will be emptied before this migration is deployed, so the design does
not preserve old `mistral-embed` vectors or support mixed vector spaces.

## Research Notes

- Jina `jina-embeddings-v5-text-small` is a text embedding model released on
  2026-02-18 with 677M parameters, 32K context, and 1024-dimensional vectors.
  Official source: https://jina.ai/models/jina-embeddings-v5-text-small/
- Jina Embeddings API endpoint is `https://api.jina.ai/v1/embeddings`. For
  `jina-embeddings-v5-text-small`, request fields include `model`, `input`,
  `task`, `dimensions`, `normalized`, `embedding_type`, and `truncate`.
  Official source: https://docs.jina.ai/index.html
- Jina retrieval should distinguish query and document embeddings with
  `retrieval.query` and `retrieval.passage`. Convex vector search uses cosine
  similarity, so Jina requests should set `normalized: true`.
- Jina model guidance and Hugging Face examples for the retrieval-targeted
  variant use `Query:` and `Document:` prefixes. The provider module should
  apply those prefixes only in the API request body while storing original chunk
  text unchanged.
- Inception Labs Mercury 2 uses OpenAI-compatible chat completions at
  `https://api.inceptionlabs.ai/v1/chat/completions`, model `mercury-2`, with a
  128K context window, tool calling, and structured outputs.
  Official source: https://docs.inceptionlabs.ai/get-started/models
- Inception structured outputs use `response_format: { type: "json_schema",
json_schema: ... }`. Official source:
  https://docs.inceptionlabs.ai/capabilities/structured-outputs
- Inception recommended defaults are `temperature: 0.75`,
  `reasoning_effort: "medium"`, and `max_tokens: 8192` for most applications.
  Official source: https://docs.inceptionlabs.ai/
- Convex vector indexes require fixed dimensions matching the stored embedding
  length, and `ctx.vectorSearch` query vectors must have the same length as the
  index. Official source: https://docs.convex.dev/vector-search
- Jina rate limits are enforced by RPM and TPM and are tracked per API key when
  a key is supplied. The user's target key tier is 100 RPM, 100,000 TPM, and 2
  concurrent requests per key, with 10 keys available. Official source:
  https://jina.ai/embeddings/
- Inception Mercury free-tier limits are 100 requests per minute, 100,000 input
  tokens per minute, and 10,000 output tokens per minute. Inception recommends
  exponential backoff for `429` and `503`. Official sources:
  https://docs.inceptionlabs.ai/get-started/rate-limits and
  https://docs.inceptionlabs.ai/resources/faq
- Convex scheduled actions run at most once and are not automatically retried.
  External provider retries must therefore be represented in database state and
  rescheduled explicitly. Official source:
  https://docs.convex.dev/scheduling/scheduled-functions

## Current State

- `package.json` depends on `@mistralai/mistralai`.
- `convex/lib/env.ts` requires `MISTRAL_API_KEY` and exposes Mistral chat and
  embedding models.
- `convex/lib/mistral.ts` owns three responsibilities: embeddings, OCR fallback,
  and grounded answer generation.
- `convex/ingestionNode.ts` imports `embedTexts` and `ocrPdfPage` from
  `convex/lib/mistral.ts`.
- `convex/search.ts` imports `embedTexts` and `generateGroundedAnswer` from
  `convex/lib/mistral.ts`.
- `convex/lib/ingestDocument.ts` supports optional page-level OCR fallback when
  `ocr` and `sourceUrl` are supplied.
- `convex/ingestionNode.ts` currently embeds all chunks inside
  `finalizeProviderResult`; any provider error during embedding marks the whole
  document failed and loses partial embedding progress.
- `convex/schema.ts` defines `chunkEmbeddings.by_embedding` with 1024
  dimensions, already compatible with Jina v5 text small.

## Decisions

1. Use direct `fetch` integrations for Jina and Inception instead of adding SDK
   dependencies. This keeps the migration small and avoids replacing one vendor
   SDK with another.
2. Delete `convex/lib/mistral.ts` and `convex/lib/mistral.test.ts` after the new
   provider modules are covered by tests.
3. Remove `@mistralai/mistralai` from dependencies and update `bun.lock`.
4. Remove all `MISTRAL_*` runtime environment variables from `getProviderEnv` and
   `.env.local.example`.
5. Keep MinerU as the document parsing provider. MinerU is not Mistral and remains
   in scope.
6. Remove Mistral OCR fallback. `finalizeProviderResult` will no longer call
   `ocrPdfPage`, no longer fetch a temporary source URL for fallback OCR, and will
   rely on MinerU output only.
7. Keep the existing Convex vector index name `by_embedding` because the database
   will be emptied and Jina vectors remain 1024-dimensional.
8. Store embedding metadata on new `chunkEmbeddings` rows for observability:
   provider, model, task, and dimensions.
9. Preserve the current answer packet contract: `answerSummary`, `answerSteps`,
   and `citationIds`.
10. Use multi-key provider pools instead of single-key env variables. Jina uses
    `JINA_API_KEYS`; Inception uses `INCEPTION_API_KEYS`. Each value is a
    comma-separated list whose order must remain stable because runtime state
    refers to keys by slot id, not by storing secrets.
11. Track per-key cooldown, disabled state, in-flight count, and per-minute usage
    windows in Convex tables. The database stores only key ids such as `jina:1`
    or `inception:4`, never raw API keys.
12. Treat `429 Too Many Requests` as capacity backpressure, not document failure.
    A key that returns `429` enters cooldown using `Retry-After` when present or
    a safe 60-75 second jittered fallback when absent.
13. Make Jina document embedding durable. Parsed pages and chunks are staged
    first, chunk embedding work is split into retryable batches, and completed
    batch embeddings are persisted before the next batch runs.
14. If all Jina keys are rate-limited while a document is embedding, keep the job
    in an in-progress waiting state and schedule the next batch after the
    earliest key cooldown. Do not mark the document failed.
15. If all keys for a provider are quota-exhausted or disabled, pause the work as
    operator-actionable capacity exhaustion. Retry only after an operator adds
    capacity or rotates keys.
16. Mercury answer generation uses the same key pool and retry primitives, but it
    remains synchronous for user searches. If all Mercury keys are cooling down,
    return a temporary unavailable error instead of fabricating an answer.

## Target Environment Variables

- `MINERU_API_TOKEN`: required.
- `MINERU_CALLBACK_SEED`: optional unless callback URL is set.
- `MINERU_CALLBACK_UID`: optional unless callback URL is set.
- `MINERU_CALLBACK_URL`: optional.
- `MINERU_DAILY_PRIORITY_PAGES`: optional numeric fallback 1000.
- `MINERU_DAILY_FILE_LIMIT`: optional numeric fallback 5000.
- `MINERU_SUBMIT_RATE_PER_MINUTE`: optional numeric fallback 50.
- `MINERU_RESULT_QUERY_RATE_PER_MINUTE`: optional numeric fallback 1000.
- `JINA_API_KEYS`: required comma-separated list; production target is 10 keys.
- `JINA_EMBED_MODEL`: optional fallback `jina-embeddings-v5-text-small`.
- `JINA_RPM_PER_KEY`: optional numeric fallback 90, intentionally below the
  user's 100 RPM per-key limit.
- `JINA_TPM_PER_KEY`: optional numeric fallback 90000, intentionally below the
  user's 100000 TPM per-key limit.
- `JINA_MAX_CONCURRENT_PER_KEY`: optional numeric fallback 2.
- `INCEPTION_API_KEYS`: required comma-separated list; production target is 10
  keys.
- `INCEPTION_CHAT_MODEL`: optional fallback `mercury-2`.
- `INCEPTION_BASE_URL`: optional fallback `https://api.inceptionlabs.ai/v1`.
- `INCEPTION_REASONING_EFFORT`: optional fallback `medium`; valid values are
  `instant`, `low`, `medium`, and `high`.
- `INCEPTION_MAX_TOKENS`: optional numeric fallback 8192.
- `INCEPTION_TEMPERATURE`: optional numeric fallback 0.75.
- `INCEPTION_RPM_PER_KEY`: optional numeric fallback 90.
- `INCEPTION_INPUT_TPM_PER_KEY`: optional numeric fallback 90000.
- `INCEPTION_OUTPUT_TPM_PER_KEY`: optional numeric fallback 9000.
- `INCEPTION_MAX_CONCURRENT_PER_KEY`: optional numeric fallback 1.

## Target Files

- `convex/lib/jina.ts`: Jina embeddings client and embedding metadata constants.
- `convex/lib/jina.test.ts`: request shape, response validation, batching, and
  error tests.
- `convex/lib/providerKeys.ts`: parse comma-separated key pools and resolve
  non-secret key ids to raw keys at runtime.
- `convex/lib/providerErrors.ts`: typed provider errors for rate limits,
  exhausted quota, transient provider failures, and permanent provider failures.
- `convex/providerRateLimits.ts`: Convex mutations for atomic key reservation,
  cooldown recording, success accounting, and key disabling.
- `convex/lib/inception.ts`: Mercury 2 grounded answer client, JSON schema, JSON
  extraction, validation, and sanitized provider errors.
- `convex/lib/inception.test.ts`: structured output request and response parsing
  tests.
- `convex/embeddingBatches.ts`: durable Jina embedding batch state machine.
- `convex/lib/env.ts`: non-Mistral provider environment parsing.
- `convex/lib/env.test.ts`: non-Mistral environment tests.
- `convex/ingestionNode.ts`: use Jina for chunk passage embeddings and remove OCR
  fallback wiring, then stage parsed content and enqueue embedding batches.
- `convex/lib/ingestDocument.ts`: expose a normalization-only helper so parsed
  content can be staged before embeddings exist.
- `convex/search.ts`: use Jina query embeddings and Mercury 2 answer generation.
- `convex/documents.ts`: stage parsed pages/chunks separately from chunk
  embeddings and store required Jina metadata with every chunk embedding row.
- `convex/schema.ts`: add required Jina metadata fields to `chunkEmbeddings`,
  provider key state, and durable embedding batch tables.
- `package.json` and `bun.lock`: remove `@mistralai/mistralai`.
- `.env.local.example`: document Jina and Inception configuration only.

## Jina Embeddings Design

The Jina module exposes two purpose-specific functions:

- `embedDocumentTexts(inputs, options?)`: sends `task: "retrieval.passage"`.
- `embedSearchQuery(question, options?)`: sends `task: "retrieval.query"`.

Both functions use the same API client and must:

- Return `[]` for empty input arrays.
- Batch requests with a default batch size of 50.
- Send `Authorization: Bearer ${selectedJinaApiKey}` from the key pool.
- Send `Content-Type: application/json` and `Accept: application/json`.
- Send `model: getProviderEnv().jinaEmbedModel`.
- Send `normalized: true`.
- Send `embedding_type: "float"`.
- Send `dimensions: 1024`.
- Send `truncate: false` so over-limit text is a provider-visible error, not a
  silent truncation.
- Validate that each returned embedding has exactly 1024 finite numeric values.
- Preserve input order using the provider `index` field when present.
- Throw sanitized errors without leaking API keys or chunk content.
- Batch by both item count and estimated tokens. The default maximum is 50 items
  and a conservative token ceiling below the reserved key's remaining TPM.
- Convert HTTP `429` into `ProviderRateLimitError` with a retry time derived
  from `Retry-After` when present.

## Provider Key Pool and Rate Limit Design

Provider key pools are parsed from comma-separated environment variables. The
runtime maps stable slot ids to raw keys, for example `jina:1` maps to the first
entry in `JINA_API_KEYS`. Slot ids are safe to persist; raw keys are not.

Before a provider request, the action estimates token usage and calls an atomic
Convex mutation to reserve capacity. Reservation increments `inFlightCount` and
per-minute counters for the selected key. If no key has capacity, the mutation
returns the earliest `retryAfterMs` rather than throwing. After the HTTP request,
the action records success, rate limit, transient failure, permanent failure, or
quota exhaustion so `inFlightCount` is always released.

The default safety margins are intentionally below the user-provided limits:
Jina reserves 90 RPM and 90,000 TPM per key, while Mercury reserves 90 RPM,
90,000 input TPM, and 9,000 output TPM per key. Jina concurrency defaults to 2
per key. Mercury concurrency defaults to 1 per key because output TPM is the
tighter bottleneck.

Rate-limit decisions are provider-specific:

- `429` with `Retry-After`: cool down only that key until the header time.
- `429` without `Retry-After`: cool down only that key for 60-75 seconds with
  jitter.
- `503` or network timeout: short retry with jitter, then reschedule durable
  work if it is ingestion.
- Invalid key or authorization failure: disable only that key and continue if
  another key is available.
- Quota or token balance exhausted: disable only that key with reason
  `quota_exhausted`; if all keys are exhausted, pause work for operator action.

## Mercury 2 Grounded Answer Design

The Inception module exports `generateGroundedAnswer(question, context,
language, options?)` so the `search.ts` call site can remain semantically close
to the current flow.

The request uses:

- URL: `${INCEPTION_BASE_URL}/chat/completions`.
- Model: `INCEPTION_CHAT_MODEL` with default `mercury-2`.
- `stream: false`.
- `temperature`: from env, default 0.75.
- `reasoning_effort`: from env, default `medium`.
- `reasoning_summary: false` to avoid extra payload the app does not consume.
- `max_tokens`: from env, default 8192.
- `response_format.type: "json_schema"`.
- Strict JSON schema with required string `answerSummary`, string array
  `answerSteps`, and string array `citationIds`.

The prompt keeps existing behavior:

- Use only provided context.
- Follow the detected response language instruction.
- Preserve technical identifiers, code, commands, and citation labels when
  translating could change meaning.
- If evidence is insufficient, return an empty `answerSteps` array and empty
  `citationIds` array.

The parser must accept plain string content and structured content arrays, then
validate the parsed object. If Mercury returns malformed JSON or fields with the
wrong type, the function throws a sanitized provider error. `search.ts` already
turns empty `answerSteps` or citation mismatches into a refusal packet.

Mercury `429` handling differs from Jina ingestion because search is currently a
synchronous user action. The client tries another non-cooling key first. If all
Mercury keys are cooling down or exhausted, search returns a temporary provider
capacity error with `retryAfterMs`. It must not save a fabricated assistant
answer.

## Durable Embedding Flow

The ingestion finalization action no longer embeds all chunks in one action
before writing document content. Instead:

1. Download and normalize the MinerU result.
2. Stage the parsed pages, chunks, source asset, and current markers in Convex.
3. Create embedding batch rows for the staged chunk ids.
4. Schedule `embeddingBatches.processNextBatch` immediately.
5. Each batch reserves a Jina key, embeds only its chunk ids, inserts
   `chunkEmbeddings`, and marks itself complete.
6. On retryable provider capacity errors, the batch records the cooldown and is
   rescheduled without deleting staged content or completed embeddings.
7. When all batches for the job are complete, exact-term indexing starts and the
   document moves to ready through the existing readiness path.

The ingestion status model adds `embedding_waiting_rate_limit` between
`embedding` and `ready`. This state means the document is still processing and
will resume automatically. It is distinct from `failed` and remains eligible for
operator recovery only if all keys are disabled or quota-exhausted.

## OCR Fallback Removal

Mistral OCR fallback is removed entirely. `finalizeProviderResult` will build
the normalized page/chunk payload from MinerU output, stage it in Convex, and
enqueue durable Jina embedding batches. It will not call `ocrPdfPage`, fetch a
temporary source URL for OCR, or perform provider OCR fallback.

This means:

- MinerU remains the only document extraction source.
- Pages flagged `needsOcrFallback` remain flagged for readiness/debugging.
- Image-only markdown blocks are still ignored by `normalizeParsedPages`.
- Ingestion should not fail just because `needsOcrFallback` is true.
- The app avoids introducing an unselected OCR provider during this migration.

## Data Model

Because the database will be emptied, schema fields can be required immediately.

`chunkEmbeddings` should add:

- `embeddingProvider: v.literal("jina")`.
- `embeddingModel: v.string()`.
- `embeddingTask: v.literal("retrieval.passage")`.
- `embeddingDimensions: v.number()`.

The existing `by_embedding` vector index remains 1024-dimensional and keeps the
same filter fields. Search does not need provider-profile filtering because all
stored rows will be Jina rows after the database reset.

`providerApiKeyStates` should store per-key state without secrets:

- `provider: v.union(v.literal("jina"), v.literal("inception"))`.
- `keyId: v.string()` using stable slot ids such as `jina:1`.
- `windowStart: v.number()`.
- `requestCount: v.number()`.
- `inputTokenCount: v.number()`.
- `outputTokenCount: v.number()`.
- `inFlightCount: v.number()`.
- `cooldownUntil: v.optional(v.number())`.
- `disabledAt: v.optional(v.number())`.
- `disabledReason: v.optional(v.string())`.
- `lastRateLimitedAt: v.optional(v.number())`.
- `updatedAt: v.number()`.

It should have an index by provider and key id, and mutations should treat that
pair as unique with `.unique()` queries.

`embeddingBatches` should store durable embedding work:

- `jobId: v.id("ingestionJobs")`.
- `documentId: v.id("documents")`.
- `batchIndex: v.number()`.
- `chunkIds: v.array(v.id("chunks"))`.
- `status: v.union(v.literal("pending"), v.literal("processing"), v.literal("rate_limited"), v.literal("retrying"), v.literal("completed"), v.literal("failed"))`.
- `attemptCount: v.number()`.
- `nextRunAt: v.optional(v.number())`.
- `lastErrorMessage: v.optional(v.string())`.
- `lastProviderKeyId: v.optional(v.string())`.
- `createdAt: v.number()`.
- `updatedAt: v.number()`.

It should have indexes by job/status and next run time.

## Testing Strategy

- Follow TDD: write each failing test first, run it and confirm the expected
  failure, then implement the minimal code.
- Unit test provider request shapes and response validation without calling live
  providers.
- Search tests should mock `embedSearchQuery` and `generateGroundedAnswer` from
  the new modules.
- Ingestion tests should verify no OCR fallback is called and Jina metadata is
  passed into staged embedding writes.
- Provider key tests should prove reservations are atomic, respect per-key RPM,
  TPM, and concurrency, and never persist raw API keys.
- Embedding batch tests should prove completed batches are not re-embedded,
  `429` schedules retry instead of failing the document, and all-key exhaustion
  pauses the job for operator action.
- Search tests should verify Mercury all-key cooldown returns a temporary
  provider-capacity error and does not save a fabricated answer.
- Environment tests should prove `MISTRAL_*` is no longer accepted or required.
- Run focused test slices after each task, then run full `bun run test` and
  mandatory `bun run lint` after code changes.

## Rollout Plan

1. Stop the app or pause ingestion/search traffic.
2. Empty the Convex database as planned by the project owner.
3. Deploy the code change that removes Mistral and requires Jina/Inception env.
4. Configure `JINA_API_KEYS`, `INCEPTION_API_KEYS`, and optional provider
   defaults. Preserve key order when rotating values.
5. Ingest documents from scratch through MinerU and Jina embeddings.
6. Run seeded evaluation questions and manual smoke tests.
7. Monitor provider errors, vector scores, exact fallback rate, and refusal rate.

## Rollback Plan

There is no runtime rollback to Mistral in this design because Mistral is removed
by requirement and the database is empty. Rollback means reverting the code
change and restoring old Mistral env/dependency from git, then re-emptying or
re-ingesting data as needed.

## Acceptance Criteria

- `@mistralai/mistralai` is absent from `package.json` and `bun.lock`.
- No runtime code imports from `@mistralai/mistralai`.
- No runtime config requires or exposes `MISTRAL_API_KEY`, `MISTRAL_CHAT_MODEL`,
  or `MISTRAL_EMBED_MODEL`.
- `convex/lib/mistral.ts` is deleted or no longer referenced by runtime code.
- Ingestion stages chunks, embeds chunks with durable Jina `retrieval.passage`
  batches, and preserves completed batch progress across rate-limit retries.
- Search embeds questions with Jina `retrieval.query`.
- Grounded answer generation calls Inception `mercury-2` structured outputs.
- Mistral OCR fallback is removed and not replaced.
- `chunkEmbeddings` stores Jina metadata for every embedding row.
- `JINA_API_KEYS` and `INCEPTION_API_KEYS` are parsed as multi-key pools, and no
  raw API key is stored in Convex tables.
- Jina `429` during document processing does not mark the document failed; it
  cools down the key and reschedules the embedding batch.
- Mercury all-key cooldown produces a temporary provider-capacity error rather
  than an ungrounded or fabricated answer.
- Existing answer packet API remains unchanged.
- Manual `Query:` and `Document:` prefixes are implementation details of the
  Jina provider. Search call sites pass the raw user question, ingestion call
  sites pass raw chunk content, and citations continue to use unmodified chunks.
- Focused tests, full tests, and `bun run lint` pass with zero errors.

## Out Of Scope

- Adding a new OCR provider.
- Adding Jina reranking.
- Switching to `jina-embeddings-v5-omni-small` or `jina-embeddings-v4`.
- Reducing embedding dimensions below 1024.
- Backfilling existing data.
- Supporting a mixed Mistral and Jina vector index.
- Adding streaming answer generation.
- Adding tool calling to Mercury 2.
