# MinerU Migration Design

**Goal:** Replace the current LlamaParse-based ingestion path with MinerU Precision API while preserving page-accurate citations, PDF viewer evidence, and the existing grounded-answer retrieval flow.

## Scope

In scope:

- replace `@llamaindex/llama-cloud` parsing in ingestion
- remove Mistral OCR from the ingestion path
- treat MinerU as the single extraction provider for parsing and OCR
- support long-running provider jobs through callback plus polling fallback
- normalize MinerU structured JSON into the application's page and chunk model
- keep citations page-based and evidence opening the original PDF page in the viewer

Out of scope:

- inline image thumbnails in answer packets
- downloading every MinerU image asset into Convex storage
- multi-document batching inside a single application ingestion job
- printed page number reconstruction beyond what MinerU already exposes reliably
- semantic image understanding beyond text, title, table, and nearby caption extraction

## Current Architecture Summary

The current ingestion pipeline is synchronous from the application's point of view:

1. `enqueue` creates an ingestion job.
2. `runDocumentJob` downloads the PDF.
3. `parseDocumentMarkdown()` polls LlamaCloud until markdown pages are returned.
4. `buildDocumentPayload()` optionally calls Mistral OCR per page.
5. Normalized chunks are embedded and persisted.
6. Search retrieves chunk embeddings and maps citations back to the source PDF.

This architecture assumes parsing finishes within a short action window. That assumption does not fit MinerU's long-running async model, especially once jobs can fall back to standard processing.

## Research Notes

Authoritative sources checked:

- MinerU API docs: `https://mineru.net/apiManage/docs`
- MinerU limit docs: `https://mineru.net/apiManage/limit`
- MinerU output files reference: `https://opendatalab.github.io/MinerU/reference/output_files/`
- LlamaParse getting started: `https://docs.cloud.llamaindex.ai/llamaparse/getting_started`

Relevant constraints:

- MinerU Precision API is the correct API for this project because it supports async extraction, callback, batch submission, and structured outputs.
- MinerU Agent API is not suitable because it is limited to small files and markdown-only results.
- Precision API results include a zip archive with `full.md` plus structured JSON outputs.
- For ingestion, structured JSON is the canonical output. Markdown is a debug and audit artifact.
- Limit data verified from documentation and page HTML:
  - task submission: `50 files/minute`
  - result queries: `1000 requests/minute`
  - daily file limit: `5000 files`
- Priority page quota has conflicting published values across MinerU pages (`1000` vs `2000`). The application must treat this as a configuration value and default conservatively.

## Chosen Approach

Use MinerU Precision API file upload mode with one application ingestion job mapped to one MinerU batch containing one file.

Why this approach:

- the app already downloads the source PDF, so file upload avoids remote URL availability problems
- MinerU file upload is more robust than asking MinerU to fetch vendor URLs directly
- MinerU batch APIs still work well for a single file and expose the async lifecycle we need
- callback support reduces polling load, while polling fallback keeps the system reliable in local development or if callback delivery fails

## Canonical Provider Output

The canonical MinerU result for the application will be the structured page JSON equivalent to the sample `mineru_example.json`, not `full.md`.

The application will use:

- `pdf_info[].page_idx` for physical page mapping
- `pdf_info[].para_blocks` for content extraction
- `pdf_info[].discarded_blocks` for optional page metadata such as `page_number`
- `table` block HTML for high-fidelity table chunks

The application will not rely on:

- markdown-only splitting for chunk generation
- raw image URLs as embedding content

## Target Architecture

### Provider Boundary

Split the provider integration into three phases:

1. submit upload and extraction task to MinerU
2. observe job status through callback or polling
3. download and normalize the final result archive

This changes the provider contract from:

- `parse(url) -> ParsedPage[]`

to:

- `submit(file) -> provider identifiers`
- `check(provider identifiers) -> provider state`
- `fetch(provider identifiers) -> structured result`

### Ingestion Lifecycle

The ingestion job state machine should become:

- `queued`
- `downloading`
- `submitting`
- `waiting_provider`
- `processing_provider`
- `downloading_result`
- `normalizing`
- `embedding`
- `ready`
- `failed`

These statuses are application-level statuses. Raw MinerU states such as `waiting-file`, `pending`, `running`, `converting`, `done`, and `failed` must be stored separately on the job.

### Job Metadata

Each ingestion job should store provider metadata needed for retries, diagnostics, and reconciliation:

- `provider`: `mineru`
- `providerBatchId`
- `providerDataId`
- `providerState`
- `providerTraceId`
- `providerResultUrl`
- `providerErrorCode`
- `providerErrorMessage`
- `providerSubmittedAt`
- `providerLastCheckedAt`
- `providerCallbackVerifiedAt`
- `priorityQuotaBucket`

`priorityQuotaBucket` is an internal inference field only:

- `priority_expected`
- `standard_possible`
- `unknown`

The system must never claim MinerU explicitly reported that a job entered the standard queue unless MinerU later exposes such a state.

## Callback and Polling Strategy

### Callback

Callback is the primary completion signal.

Requirements:

- expose a Convex HTTP endpoint for MinerU callback delivery
- verify checksum using the documented signing flow
- parse the callback body into provider state updates
- mark the job ready for result download when MinerU indicates completion

### Polling Fallback

Polling is the safety net.

Use polling when:

- callback is not configured in a local or preview environment
- callback delivery fails
- callback was received but the result fetch did not finish cleanly
- a job is stuck in a provider state longer than expected

Polling should use bounded backoff and reconciliation scheduling, not tight loops inside a single action.

## Result Normalization Strategy

### Internal Model

MinerU structured output should be transformed into an internal page/block representation before being converted into the existing persistence model.

Internal representation per page:

- `pageNumber`
- `printedPageNumber?`
- `blocks[]`
- `renderedMarkdown`
- `hasVisualEvidence`
- `lowSearchValue`

Block representation should distinguish at minimum:

- `title`
- `text`
- `table`
- `image`
- `discarded`

### Rendering `documentPages.markdown`

Each page markdown should be rendered deterministically from blocks:

- `title` -> heading markdown
- `text` -> paragraph text
- `table` -> HTML table string
- `image` -> markdown image or image placeholder line
- `discarded` -> omitted from page markdown by default

This keeps page inspection readable without making page markdown the source of truth for chunking.

### Chunk Construction

Chunks must become block-aware instead of regex-based markdown splits.

Rules:

- merge adjacent `title` and `text` blocks where it improves retrieval and stays page-local
- always keep a `table` as its own chunk
- do not embed raw image URLs
- do not embed `header`, `footer`, or other discarded boilerplate blocks
- if a page has only image blocks and no useful text, mark it as low-search-value instead of creating noisy chunks

### Chunk Type Classification

Chunk classification should use structured block type plus content heuristics:

- `warning`: warning and safety language such as `WARNING`, `ATTENTION`, `IMPORTANT`, `SHOCK HAZARD`, `ARC FLASH`
- `table`: table blocks
- `spec`: technical text mentioning catalog numbers, module specs, terminals, connectors, or similar product facts
- `diagram_description`: caption-like text near diagrams or figures
- `text`: everything else

## RAG and Image Evidence Behavior

For v1 of the migration:

- image evidence is supported indirectly through the existing PDF page viewer
- answer packets remain text-first
- citations still point to source PDF pages
- the user clicks a citation and sees the original PDF page containing the image or diagram
- the answer packet will not render extracted image thumbnails inline

This preserves current UX while avoiding a larger evidence-asset redesign.

Limitations accepted in v1:

- pure image pages with no meaningful caption text will be weak retrieval candidates
- images will not be embedded semantically on their own

## Quota and Rate-Limit Strategy

The application should be conservative and configurable.

Environment configuration should include:

- `MINERU_API_TOKEN`
- `MINERU_CALLBACK_URL`
- `MINERU_CALLBACK_SEED`
- `MINERU_DAILY_PRIORITY_PAGES`
- `MINERU_DAILY_FILE_LIMIT`
- `MINERU_SUBMIT_RATE_PER_MINUTE`
- `MINERU_RESULT_QUERY_RATE_PER_MINUTE`

Policy:

- do not block normal OSS usage merely to preserve priority quota
- submit jobs normally until the hard daily file cap would be exceeded
- internally tag jobs as `standard_possible` once the app believes priority quota may be exhausted
- surface waiting states honestly in the admin UI

## Failure Handling

### Fail Fast

Do not retry indefinitely for:

- invalid token
- expired token
- unsupported file type
- file too large
- page count above supported limit
- malformed callback

### Retry With Backoff

Retry with backoff for:

- temporary provider errors
- queue saturation
- network failures
- zip download failures
- transient callback processing failures

### Reconciliation

Scheduled reconciliation must detect:

- jobs with provider IDs but missing finalization
- jobs stuck in `waiting_provider` or `processing_provider`
- jobs where callback was never received
- jobs where result URL exists but normalization did not complete

## UI and Operations

The admin ingestion list should expose both application status and provider context.

At minimum, show:

- status badge
- last provider state if present
- provider error code and message if present
- last checked timestamp
- retry button only when retry is safe

Suggested user-facing copy:

- `Pending`
- `Parsing`
- `Fetching`

Do not claim `standard queue` as a provider fact. That wording should only be used if presented as an internal expectation or explanation.

## Testing Strategy

Required automated coverage:

- MinerU env parsing and missing-config behavior
- provider submission and status mapping
- callback checksum verification
- polling reconciliation behavior
- zip result download and structured JSON extraction
- `middle.json` to internal page/block normalization
- page markdown rendering
- chunk construction from titles, text, and tables
- exclusion of discarded blocks from embeddings
- state machine transitions for the new ingestion statuses
- admin UI rendering of waiting and provider-processing states

Fixtures should be based on the provided MinerU sample outputs.

## Rollout Plan

1. land MinerU integration alongside the existing retrieval stack
2. migrate ingestion from LlamaParse to MinerU
3. keep answer generation and embeddings unchanged
4. validate with the GuardLogix sample manual
5. verify page-accurate citations and evidence viewer behavior
6. monitor provider waiting behavior under realistic queue delays

## Explicit Decisions

- Use MinerU Precision API file upload mode.
- Use structured JSON as the canonical parse output.
- Keep PDF-page evidence viewer behavior in v1.
- Do not embed raw image URLs.
- Do not inline image thumbnails in answer packets in v1.
- Make quota values configurable because published MinerU priority quota values are inconsistent.
