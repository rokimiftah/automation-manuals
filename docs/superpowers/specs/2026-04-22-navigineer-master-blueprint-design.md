# Navigineer Master Blueprint Design

## Document Status

- Status: Draft approved in conversation, written for user review
- Date: 2026-04-22
- Product: Navigineer
- Scope type: Master blueprint with phased thin slices
- First implementation target: SP1 Platform Core

## 1. Product Summary

Navigineer is a single-tenant internal AI assistant for field engineers that answers technical troubleshooting and installation questions using only official vendor documentation as the source of truth.

The product exists to reduce the time engineers spend searching long manuals while preserving trust. It is not positioned as an all-knowing expert. It is positioned as a fast, conservative research assistant that returns grounded answers, citations, and visual evidence from the original manual.

The core product promise is:

- let engineers ask natural-language questions
- search official manuals, tables, and diagrams
- return evidence-bounded answers with citations
- show the supporting page or asset for verification
- refuse to speculate when evidence is weak or absent

## 2. Problem Statement

Industrial manuals are difficult to use in urgent field scenarios because relevant information is often buried inside hundreds of pages of dense documentation. The most important answers are frequently stored in:

- technical specification tables
- LED or alarm status tables
- wiring diagrams
- slot placement diagrams
- warnings and procedural notes across multiple pages

Traditional PDF search and basic text-only RAG systems fail on this material because they break layout, lose table structure, ignore diagram semantics, or answer confidently without enough evidence.

## 3. Product Boundary

Navigineer is designed as a controlled internal tool, not a public knowledge portal.

### In Scope

- single-tenant internal workspace
- admin-curated official vendor documents only
- multimodal ingestion for technical PDFs
- evidence-bounded retrieval and answer generation
- split-screen workspace for answer plus verification
- admin workflow for document lifecycle and ingestion monitoring
- evaluation framework for retrieval and answer quality

### Explicitly Out of Scope for v1

- multi-tenant SaaS
- billing and subscriptions
- public user uploads
- on-prem AI infrastructure
- live PLC, SCADA, or device integrations
- autonomous agent actions without human verification
- enterprise SSO or SCIM
- collaborative annotations between users

## 4. Users and Roles

### Admin

Responsible for:

- registering official documents
- managing document versions and active status
- starting or retrying ingestion jobs
- monitoring parser and index results
- deactivating faulty or outdated document versions

### Engineer

Responsible for:

- asking technical questions
- reviewing grounded answers
- verifying citations and assets in the viewer
- saving findings within their own workspace history

No other roles are needed in SP1.

## 5. Operating Principles

These principles govern the entire product and override convenience-oriented shortcuts.

### 5.1 Evidence First

Every actionable answer must be tied to structured evidence. A citation is not free text decoration. It must map to a real document page and viewer target.

### 5.2 Conservative Answering

If evidence is insufficient, the system must refuse to speculate. The correct failure mode is a useful refusal, not a fluent guess.

### 5.3 Verification Over Blind Trust

The UI is designed to help engineers validate claims directly against the manual, especially for wiring, slots, alarms, and safety-critical instructions.

### 5.4 Controlled Sources

Only admin-curated official vendor documentation is allowed into the knowledge base.

### 5.5 Recovery Over Perfection

The system must support partial failures, targeted retries, and document deactivation. Perfect first-pass parsing is not assumed.

## 6. Technical Decisions

This section records the concrete architectural choices validated during brainstorming.

### 6.1 Frontend Framework

- Astro is the application shell
- React islands power interactive areas
- output mode should be hybrid, not full SPA and not fully static

Reasoning:

- Astro keeps most pages lightweight by default
- interactive surfaces can stay isolated to admin and engineer workspace islands
- this aligns with the current repository stack

### 6.2 Backend and Operational State

- Convex is the operational backend and database
- public reads and writes are exposed through Convex functions
- external API work runs in Convex actions

Reasoning:

- the product needs application state, job state, role-aware access, chat state, and vector search in one system
- Convex vector search must run inside actions according to current official docs

### 6.3 Search Architecture

- vector retrieval is the SP1 baseline
- embeddings are stored in a separate table from chunk payloads
- metadata filters are applied during vector search where possible
- hybrid retrieval is deferred to SP2

Reasoning:

- official Convex docs recommend a separate embeddings table when vector payloads are large and should not be loaded during ordinary reads
- this keeps chunk queries cleaner and avoids hauling large float arrays through normal UI reads

### 6.4 File and Asset Storage

- Convex File Storage is the SP1 default for PDFs and extracted viewer assets
- external CDN or object storage is deferred until a real scaling need appears

Reasoning:

- it keeps SP1 smaller
- it is sufficient for storing source PDFs and generated visual evidence during early validation

### 6.5 Parsing Strategy

- LlamaParse is the primary parsing engine
- Mistral OCR is a fallback or augmentation path for difficult pages, diagrams, and low-quality extraction cases
- Mistral OCR is not the default parser for every page

Reasoning:

- LlamaParse is suited to technical PDF parsing
- Mistral OCR exposes table formatting, images, page selection, and confidence signals that make it appropriate as a targeted recovery path
- provider costs and rate limits make blanket OCR wasteful

### 6.6 Authentication Baseline

- Convex Auth beta is the SP1 auth baseline by explicit user choice
- sign-in methods: password and magic link

Important constraint:

- this is a pragmatic SP1 choice, not the most production-mature option
- the design must isolate auth behind clear feature boundaries so the provider can be replaced later if needed

### 6.7 Auth Security Position

- internal-tool access only
- no unrestricted public sign-up
- access must be constrained by invite list, allowlist, or other server-side admission control
- admin role assignment must happen only in server-side code
- magic link flow must include a confirmation or interstitial step to reduce session fixation or phishing risk
- password flow must include reset support

## 7. Architecture Overview

The platform is composed of six main layers.

### 7.1 Admin Intake Layer

Admins register official vendor documents with metadata such as:

- vendor
- product family
- document title
- revision or version
- language
- source URL
- category

This layer is also responsible for controlling which document version is active for search.

### 7.2 Ingestion Pipeline

The ingestion pipeline:

- stores the source PDF
- parses content into page-level artifacts
- normalizes output into structured chunks and assets
- routes low-quality pages into fallback OCR when needed
- generates embeddings
- marks document readiness only after minimum validation passes

### 7.3 Knowledge Asset Layer

The system stores normalized evidence as first-class application records, not opaque parser blobs. These include:

- page metadata
- text chunks
- table chunks
- diagram descriptions
- viewer assets
- citations and answer evidence links

### 7.4 Retrieval and Answering Layer

The answering layer:

- embeds the user query
- performs vector retrieval with filters
- assembles an evidence pack
- prompts the LLM with only the selected evidence
- returns a structured answer packet

### 7.5 User Workspace Layer

Engineers use a split-screen workspace:

- left: chat and structured answer
- right: evidence viewer with cited page or asset

### 7.6 Governance and Observability Layer

The system tracks:

- ingestion jobs
- provider failures
- retries
- audit events
- evaluation cases
- refusal rates and answerability signals

## 8. Domain Model

The domain model is intentionally small but sufficient for ingestion, retrieval, citations, and operations.

### 8.1 Core Entities

- `users`
- `vendors`
- `products`
- `documents`
- `ingestion_jobs`
- `document_pages`
- `document_assets`
- `chunks`
- `chunk_embeddings`
- `chat_sessions`
- `chat_messages`
- `answer_evidence`
- `evaluation_cases`
- `audit_events`

### 8.2 Entity Notes

#### users

Contains authenticated application users plus role metadata.

#### vendors

Represents vendor names such as Allen-Bradley or Siemens.

#### products

Represents a product family or equipment line associated with a vendor.

#### documents

Represents a single official manual revision. Each revision should be a separate record. Document lineage may be tracked, but search must not blur revisions by default.

#### ingestion_jobs

Represents each parse or re-index attempt. Jobs have explicit state transitions and failure reasons.

#### document_pages

Stores page-level information including logical page number, source page index, and page-level quality metadata.

#### document_assets

Stores references to source PDFs, page images, diagram crops, or other viewer-renderable artifacts.

#### chunks

Stores human-meaningful retrieval payloads. Chunk types should be explicit, for example:

- `text`
- `table`
- `diagram_description`
- `warning`
- `spec`

#### chunk_embeddings

Stores embedding vectors in a separate table linked back to chunk records.

#### chat_sessions and chat_messages

Track engineer query history and structured answer packets.

#### answer_evidence

Stores the explicit relationship between an answer and the chunk or asset used as evidence. This must be structured, not embedded as a string.

#### evaluation_cases

Stores regression and quality test cases used for retrieval and answer evaluation.

#### audit_events

Stores admin-sensitive lifecycle actions such as ingest, retry, activation, and deactivation.

## 9. Frontend Composition

The repository already follows Feature-Sliced Design. The product should extend that structure instead of replacing it.

### 9.1 Entities

- `entities/auth`
- `entities/document`
- `entities/knowledge`
- `entities/chat`

### 9.2 Features

- `features/auth`
- `features/ask-assistant`
- `features/view-evidence`
- `features/admin-ingestion`

### 9.3 Widgets

- `widgets/app-shell`
- `widgets/engineer-workspace`
- `widgets/admin-console`

### 9.4 Route Surfaces

- `/`
- `/auth`
- `/app`
- `/admin`

### 9.5 Island Boundaries

Likely islands include:

- `AuthIsland`
- `EngineerWorkspaceIsland`
- `AdminDocumentsIsland`
- `IngestionJobsIsland`
- `EvidenceViewerIsland`

Only interactive areas should be hydrated.

## 10. Convex Backend Boundaries

The backend should be organized by domain responsibilities.

Recommended modules:

- `convex/auth.ts`
- `convex/auth.config.ts`
- `convex/schema.ts`
- `convex/users.ts`
- `convex/vendors.ts`
- `convex/documents.ts`
- `convex/ingestion.ts`
- `convex/assets.ts`
- `convex/search.ts`
- `convex/chats.ts`
- `convex/evaluations.ts`
- `convex/audit.ts`
- `convex/http.ts` when webhook or HTTP callbacks are needed

### Function Type Policy

- `query` for reactive UI reads
- `mutation` for application state transitions
- `action` for external API calls and vector search
- `internal` functions for privileged operations that should never be callable from the client

## 11. Operational Workflows

### 11.1 Admin Ingestion Flow

1. Admin registers an official document and metadata.
2. The system stores the source PDF.
3. A new `ingestion_job` is created.
4. The parser produces page-level text, table, and image output.
5. The normalizer converts parser output into chunks and assets.
6. Low-quality pages may trigger targeted Mistral OCR fallback.
7. Embeddings are generated for normalized retrieval units.
8. Validation checks run.
9. The document becomes `ready` only if minimum evidence and viewer requirements are met.

Required minimum readiness checks:

- chunk records exist
- page mapping is valid
- source file is accessible
- at least one citation target can render correctly in the viewer

### 11.2 Engineer Ask Flow

1. Engineer submits a natural-language question.
2. The system embeds the query.
3. A Convex action runs vector search with relevant metadata filters.
4. Candidate chunks and viewer assets are loaded.
5. An evidence pack is assembled.
6. The LLM receives only the question and evidence pack.
7. The LLM returns a structured answer packet.
8. The UI renders answer plus evidence.

Structured answer packet fields should include:

- `answer_summary`
- `answer_steps`
- `citations[]`
- `supporting_assets[]`
- `answerability_status`
- optional `confidence_band`

### 11.3 Evidence Verification Flow

When the user clicks a citation, the viewer must open the exact page or asset tied to that evidence record.

### 11.4 Admin Recovery Flow

Admins must be able to:

- retry ingestion by document
- retry ingestion by page range where practical
- deactivate faulty documents or versions
- inspect failure categories

## 12. Trust, Safety, and Access Control

### 12.1 Source Integrity

- only admin-curated official documents may be ingested
- active search should default to the intended document version rather than mixing revisions

### 12.2 Answer Constraints

- answers must stay within supplied evidence
- actionable hardware instructions require explicit citations
- weak retrieval must not be disguised with confident wording

### 12.3 Role Boundaries

- only admins can ingest, retry, activate, or deactivate documents
- engineers can query and read their own workspace history
- sensitive state transitions belong in internal server-side functions when not needed by the client

### 12.4 Auth and Token Safety

Because Convex Auth stores tokens client-side by default, the frontend must be strict about XSS prevention.

Mandatory rules:

- no raw HTML rendering from parser output
- no raw HTML rendering from LLM output
- markdown or rich rendering must use safe structured rendering paths
- do not use `dangerouslySetInnerHTML` for document or answer content unless strictly sanitized and justified

## 13. Quality Model

The product needs separate quality gates for ingestion, retrieval, and answers.

### 13.1 Ingestion Quality

Track at minimum:

- parse success rate
- pages with no usable chunks
- tables or diagrams without valid page mappings
- pages routed to OCR fallback

### 13.2 Retrieval Quality

Track at minimum:

- evidence recall at k
- document version correctness
- citation anchor validity

### 13.3 Answer Quality

Track at minimum:

- groundedness
- refusal correctness
- actionability
- safety phrasing for operational or safety-critical instructions

## 14. Evaluation Framework

Evaluation cases are part of the product design, not an optional follow-up.

Each case should include:

- user question
- target document or version
- expected evidence page or asset
- expected answer pattern or refusal expectation
- severity level: `informational`, `operational`, or `safety-critical`

Required case categories:

- exact lookup
- table reasoning
- diagram reasoning
- cross-page context
- not found refusal
- wrong version trap

## 15. Failure Modes and Degradation Strategy

The system must treat the following as normal possibilities:

- broken table extraction
- unreadable diagrams
- missing or invalid citation anchors
- retrieval against the wrong document version
- OCR fallback cost explosion
- user questions that are unsupported by the manual

Design rules:

- fail visibly, not silently
- refuse when uncertain
- retry surgically, not globally

Implications:

- partial readiness states are allowed
- targeted retries are preferred to full reprocessing
- missing evidence should reduce answerability, not trigger confident paraphrasing

## 16. Cost and Rate-Limit Controls

The design must account for real provider limits and avoid optimistic assumptions.

### 16.1 LlamaParse Constraints

- free plan includes 10K credits, not 10K credits per day
- free tier rate limit is lower and documented at 20 requests per minute

### 16.2 Cost Control Rules

- ingestion is admin-only
- use checksum or hashing to avoid unnecessary reprocessing
- support page-range retry instead of full reparse where possible
- use OCR fallback only on pages that need it
- separate experimental and operational ingestion flows when possible

### 16.3 Minimum Usage Visibility

Track at least:

- parse credit estimates
- OCR usage estimates
- embeddings count
- failed and retried job counts

## 17. Observability

SP1 does not require enterprise observability, but the blueprint requires a minimum operational layer.

Track at least:

- ingestion job state
- failure category
- external provider latency
- retrieval result summaries
- refusal counts and answerability outcomes
- admin audit events

## 18. Non-Functional Requirements

- traceability is more important than answer fluency
- conservative correctness is more important than broad coverage
- recoverability is more important than perfect first-pass parsing
- the evidence viewer must work reliably on desktop and be readable on mobile
- every actionable answer must be tied to evidence

## 19. Phased Delivery Model

The full blueprint is delivered through five slices.

### SP1 Platform Core

Deliver one complete end-to-end path:

- auth
- curated document intake
- ingestion state
- retrieval
- structured answer with citations
- split-screen evidence viewer

### SP2 Knowledge Quality

- hybrid retrieval
- metadata enrichment
- tuning and ranking improvements
- expanded evaluation suite

### SP3 Admin Operations

- richer retry and reprocess flows
- version management improvements
- observability and cost controls

### SP4 User Experience Depth

- chat history improvements
- saved findings
- richer table rendering
- document drill-down and better mobile treatment

### SP5 Production Readiness

- security hardening
- monitoring and backup strategy
- deployment and governance workflows

## 20. SP1 Design Scope

SP1 is the first implementation target and must remain a thin slice.

### 20.1 SP1 In Scope

- Convex Auth beta with password and magic link
- admin and engineer roles
- admin-curated official document registration
- one ingestion pipeline that stores source PDF, parses, normalizes, embeds, and tracks job state
- engineer workspace with ask flow
- structured answer packet with citations
- evidence viewer with at least one valid page or asset route
- admin visibility into ingestion job state and targeted retry entry points

### 20.2 SP1 Non-Goals

- multi-tenant support
- billing
- enterprise SSO
- collaborative notes
- advanced reranking
- full analytics dashboards
- full document governance UI
- autonomous troubleshooting agent behavior

### 20.3 SP1 Acceptance Criteria

1. An admin can register an official manual and run ingestion until it becomes `ready`.
2. At least one complex sample manual can be ingested into searchable evidence.
3. An engineer can ask a question and receive:
   - a structured answer
   - one or more citations
   - supporting evidence in the viewer
4. For unsupported or weak-evidence questions, the system refuses to speculate.
5. Clicking a citation opens the correct page or asset target.
6. Engineers cannot perform admin ingestion actions.
7. A minimum evaluation seed set exists for regression checks.

## 21. SP1 Testing Strategy

### 21.1 Unit Tests

- normalizer behavior
- chunk typing or classification helpers
- answer packet shaping
- citation formatting helpers
- auth and role guards

### 21.2 Integration Tests

- ingestion state transitions
- retrieval action with mocked providers
- document readiness flow
- protected route and role access behavior

### 21.3 Product and Evaluation Tests

- exact lookup
- table lookup
- diagram-backed answer
- not-found refusal
- wrong-role access denial

### 21.4 Manual QA

- admin imports sample GuardLogix manual
- engineer asks representative troubleshooting and configuration questions
- reviewer verifies citations and refusal behavior

## 22. Primary Risks

### 22.1 Auth Risk

Convex Auth is beta and the chosen password plus magic-link combination increases SP1 auth surface.

### 22.2 Parsing Risk

Diagram and table quality may vary enough to require more fallback behavior than expected.

### 22.3 Viewer Mapping Risk

The hardest user-facing correctness issue may be mapping chunks back to the right page or asset target.

### 22.4 Provider Limit Risk

Free-tier limits and credits can slow iteration if retries are broad and expensive.

## 23. Risk Mitigations

- isolate auth behind a dedicated feature boundary
- isolate parser, OCR, embedding, and answer providers behind adapters
- keep embeddings in a separate table
- keep answer responses structured instead of string-only
- create evaluation cases from the beginning
- prefer targeted reprocessing and targeted OCR fallback

## 24. Research Notes

These notes capture the authoritative constraints used in the design.

### Astro

- latest docs identify Astro `v6.1.8`
- islands and hybrid rendering remain the correct fit for a content-first shell with isolated interactive workspaces

Sources:

- `https://docs.astro.build/en/upgrade-astro/`
- `https://docs.astro.build/en/concepts/islands/`

### Convex

- vector search is only available in actions
- separate embedding tables are a supported advanced pattern
- built-in file storage is appropriate for SP1 asset handling

Sources:

- `https://docs.convex.dev/search/vector-search`
- `https://docs.convex.dev/file-storage`
- `https://docs.convex.dev/auth`

### Convex Auth

- Convex Auth is beta and may change incompatibly
- password flow needs reset support for a proper operational setup
- magic links need additional care to reduce phishing or session fixation risk
- tokens are accessible to client JavaScript by default, increasing the importance of XSS prevention

Sources:

- `https://docs.convex.dev/auth`
- `https://labs.convex.dev/auth/config/passwords`
- `https://labs.convex.dev/auth/config/email`
- `https://labs.convex.dev/auth/security`

### LlamaParse

- free plan includes 10K credits
- free-tier organizations have lower rate limits at 20 requests per minute

Sources:

- `https://www.llamaindex.ai/pricing`
- `https://developers.llamaindex.ai/python/cloud/general/rate_limits/`

### Mistral OCR

- `mistral-ocr-latest` supports document URLs, table formatting, image extraction, page targeting, and confidence outputs
- it is suitable as a fallback or augmentation path for difficult document pages

Sources:

- `https://docs.mistral.ai/capabilities/document_ai/basic_ocr/`
- `https://docs.mistral.ai/api/endpoint/ocr`

## 25. Final Recommendation

Proceed with the full product blueprint but execute only SP1 first.

This preserves the long-term architecture while keeping the first build focused on the smallest usable proof of value:

- one controlled knowledge source path
- one trustworthy answer path
- one evidence viewer path
- one admin workflow path

If SP1 proves that engineers can obtain faster, grounded, verifiable answers from real manuals, then SP2 through SP5 become optimization and scale work rather than speculation.
