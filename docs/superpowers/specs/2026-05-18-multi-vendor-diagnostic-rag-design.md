# Multi-Vendor Diagnostic RAG Design

## Document Status

- Status: Proposed and approved in chat for product direction
- Date: 2026-05-18
- Product: Automation Manuals
- Scope type: Product intelligence and retrieval design

## 1. Goal

Make Automation Manuals capable of handling field-engineer questions that are written as real troubleshooting narratives, while still grounding every actionable answer in official vendor documentation.

The platform should support multi-vendor documentation from the start, but answers must remain scoped to the correct vendor, product, model, and active manual version whenever the question is operational or safety-critical.

The target behavior is:

- understand engineer-written problem descriptions
- extract the likely intent, product context, symptom, error code, and installation stage
- retrieve evidence from the correct official documents
- answer only when evidence is strong enough
- ask precise follow-up questions when the vendor, product, model, or manual context is ambiguous
- refuse to speculate when the manuals do not support a conclusion

## 2. Problem Statement

Engineers rarely ask questions as clean keyword searches. They often describe a situation in natural language, for example:

```text
Saya install drive baru, setelah power on muncul F002. Motor belum jalan.
```

A basic PDF chatbot may produce a fluent answer, but in a multi-vendor environment the same code, symptom, or term can mean different things depending on vendor, product family, model, firmware, and manual revision.

For this product, a wrong confident answer is worse than a useful clarification question. The system must therefore behave like a conservative diagnostic assistant, not an unrestricted general chatbot.

## 3. Design Decision

Use a multi-vendor diagnostic RAG approach built in layers.

The platform should combine:

- vendor-scoped retrieval as the safety baseline
- query understanding before retrieval
- hybrid semantic and literal retrieval
- structured evidence packs
- citation-backed answer generation
- refusal and clarification behavior when context is incomplete

This means multi-vendor support is part of the data model and retrieval design from the start, but answer generation must not freely mix evidence across vendors unless the user is explicitly asking for a comparison.

## 4. Considered Approaches

### 4.1 Simple Multi-Vendor RAG

All PDFs are loaded into one knowledge base and the system retrieves the most semantically relevant chunks.

Benefits:

- fastest to implement
- useful for demos
- minimal metadata requirements

Rejected because:

- it can retrieve the wrong vendor or product manual
- error codes and parameter names can collide across vendors
- it encourages overconfident answers when context is missing
- it is unsafe for installation, wiring, alarm, and troubleshooting guidance

### 4.2 Vendor-Scoped RAG

The system detects or requires vendor and product context before retrieval, then searches only within the relevant document set.

Benefits:

- safer than global retrieval
- easier to explain citations
- reduces cross-vendor false positives
- aligns with official-document source control

Limitations:

- it can feel rigid if the engineer does not know the exact model
- it still needs intent detection and follow-up questions
- it does not fully handle narrative troubleshooting by itself

This is the minimum acceptable baseline.

### 4.3 Multi-Vendor Diagnostic Intelligence

The system first interprets the engineer's narrative, extracts structured diagnostic context, checks whether enough context exists, and only then retrieves from scoped official documents.

Benefits:

- best fit for real engineer questions
- supports ambiguity handling before answer generation
- improves safety for installation and troubleshooting use cases
- creates clear evaluation targets for retrieval and answer quality

Trade-offs:

- requires disciplined metadata and evaluation cases
- needs explicit answerability and clarification rules
- is more complex than a simple RAG chatbot

This is the recommended approach.

## 5. User Experience Principles

### 5.1 Understand Stories, Not Just Keywords

The system should accept natural-language descriptions and extract the practical troubleshooting intent.

For example:

```text
Saya punya masalah ketika install, muncul error F002 setelah power on.
```

The system should infer candidate fields such as:

- intent: troubleshooting
- phase: installation or first power-on
- symptom: fault or error
- literal identifier: F002
- product category: drive or inverter, if implied
- missing context: vendor, model, firmware, or document family

### 5.2 Ask When Context Is Missing

If a question is ambiguous across vendors or products, the system must ask for the smallest useful missing detail instead of guessing.

Example response:

```text
Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter agar saya bisa mengambil manual yang tepat.
```

### 5.3 Show Evidence, Not Just Answers

Every actionable recommendation must include citations that map to a document page or viewer asset.

The answer should make it easy for the engineer to verify:

- source manual
- page number or section
- table, warning, or procedure used as evidence
- confidence or answerability status

### 5.4 Be Conservative For Safety-Critical Guidance

Installation, wiring, power, protection, safety interlock, and fault-reset instructions require strong evidence. If evidence is weak, the system should clarify or refuse.

## 6. Query Understanding Layer

Before retrieval, the system should produce a structured interpretation of the question.

Recommended fields:

- `intent`: `lookup`, `installation_help`, `troubleshooting`, `wiring`, `configuration`, `specification`, `comparison`, or `unknown`
- `severity`: `informational`, `operational`, or `safety_critical`
- `vendor`: detected vendor name or `unknown`
- `product_family`: detected product family or `unknown`
- `model`: detected model or part number or `unknown`
- `document_scope`: detected document title, revision, or language when available
- `stage`: installation, commissioning, first power-on, operation, maintenance, or unknown
- `symptoms`: natural-language symptoms
- `literal_identifiers`: error codes, fault codes, parameters, part numbers, catalog numbers, or terminal labels
- `missing_context`: required fields that are not known yet

This output should guide retrieval and answer behavior. It should not be treated as final truth without evidence.

## 7. Retrieval Rules

### 7.1 Scope Before Search

For operational or safety-critical questions, retrieval should be scoped before answer generation.

Preferred filter order:

1. active document version
2. vendor
3. product family
4. model or model family
5. document category
6. language

If the required scope is missing, the system should ask a follow-up question unless the answer is clearly vendor-neutral and supported by official documentation.

### 7.2 Hybrid Candidate Generation

The system should combine:

- semantic vector retrieval for natural-language descriptions
- exact or literal retrieval for error codes, model numbers, parameter names, terminal labels, and quoted phrases
- metadata filtering for vendor, product, revision, and document status
- deterministic deduplication by chunk identifier

Literal matches should be prioritized for lookup-like queries, error codes, model numbers, and short exact phrases.

### 7.3 Cross-Vendor Results

Cross-vendor retrieval is allowed only when:

- the user explicitly asks for comparison
- the system is trying to identify possible vendors before asking a clarification question
- the answer is clearly marked as ambiguous and does not provide final operational instructions

The system must not combine instructions from different vendors into a single troubleshooting procedure.

## 8. Evidence Model

Evidence should be normalized into first-class records rather than opaque PDF text.

Recommended evidence types:

- text procedure
- fault or alarm table
- parameter table
- specification table
- wiring diagram description
- LED or status indicator table
- safety warning
- installation prerequisite
- revision note

Each evidence item should preserve:

- document identifier
- vendor
- product family
- model scope where known
- manual revision
- page number or page index
- section or citation label
- chunk type
- extracted content
- viewer target or asset reference

## 9. Answer Contract

Answers should be structured, not free-form only.

Recommended answer fields:

- `answerability_status`: `answerable`, `needs_clarification`, or `not_supported`
- `interpreted_problem`: concise restatement of what the system understood
- `clarifying_question`: present only when context is missing
- `answer_summary`: grounded summary when answerable
- `recommended_steps`: ordered troubleshooting or installation steps when supported
- `safety_notes`: warnings or constraints from the manual
- `citations`: evidence references used in the answer
- `confidence_band`: conservative confidence label based on retrieval and evidence strength

If the status is `needs_clarification`, the response should ask one focused question instead of presenting a long speculative answer.

If the status is `not_supported`, the response should explain that the active official manuals do not contain enough evidence.

## 10. Example Flow

Input:

```text
Saya install drive baru, setelah power on muncul F002. Motor belum jalan.
```

Query understanding:

```text
intent: troubleshooting
severity: operational
stage: first power-on
symptoms: motor not running after power on
literal_identifiers: F002
vendor: unknown
product_family: drive/inverter candidate
missing_context: vendor, model
```

Response:

```text
Kode F002 dapat berbeda antar vendor dan model. Sebutkan vendor dan model drive/inverter agar saya bisa mengambil manual yang tepat sebelum memberi langkah troubleshooting.
```

Follow-up input:

```text
Siemens SINAMICS G120
```

Retrieval behavior:

- filter active Siemens SINAMICS G120 manuals
- prioritize exact match for `F002`
- retrieve installation and first-power-on context if available
- build an evidence pack with citations

Answer behavior:

- summarize the fault using cited evidence
- provide supported checks only
- include safety notes if the manual requires them
- cite the exact manual pages or sections

## 11. Failure Handling

The system should fail closed in the following cases:

- no active document matches the detected vendor or product
- multiple vendors match the same error code and the user has not specified context
- retrieved evidence does not support the requested conclusion
- citations cannot be mapped to viewer targets
- the answer would require operational steps not found in official documentation

Expected behavior is a clarification or refusal, not an invented answer.

## 12. Evaluation Strategy

The platform should be evaluated with realistic multi-vendor engineer questions.

Required case categories:

- vague installation issue that requires clarification
- error code lookup with exact vendor and model
- error code collision across vendors
- wrong manual version trap
- wiring or terminal question
- parameter configuration question
- safety-critical instruction request
- unsupported question requiring refusal
- cross-vendor comparison request

Each evaluation case should define:

- user question
- expected intent
- expected missing-context behavior, if any
- expected vendor and document scope
- expected evidence page or section
- expected answerability status
- expected refusal condition, if applicable

## 13. Acceptance Criteria

This design is satisfied when:

- narrative engineer questions are interpreted into structured diagnostic context
- operational answers are scoped to vendor, product, model, and active manual version when available
- ambiguous multi-vendor questions trigger a focused clarification question
- error codes and part numbers use literal retrieval in addition to vector retrieval
- answer generation uses only supplied evidence
- actionable steps include citations to official documentation
- unsupported or weakly supported questions produce a safe refusal
- evaluation cases cover ambiguity, collisions, wrong-version traps, and safety-critical prompts

## 14. Implementation Boundary

This design defines the intelligence behavior and retrieval constraints. It does not require a full multi-agent system, live device integration, PLC/SCADA connectivity, or autonomous field actions.

The first implementation plan should focus on the smallest vertical slice:

- query understanding output
- scoped hybrid retrieval inputs
- clarification behavior for missing vendor or model context
- answer contract updates if needed
- evaluation cases for multi-vendor ambiguity
