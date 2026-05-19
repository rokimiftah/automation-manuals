# Multi-Vendor Diagnostic RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first multi-vendor diagnostic RAG slice so operational engineer questions with missing vendor or model context return a focused clarification, while questions with detected vendor/product context search only matching official evidence.

**Architecture:** Keep `convex/search.ts` as the search orchestration boundary. Add a pure diagnostic query-understanding helper, extend the answer packet contract with `needs_clarification`, and pass a scoped retrieval filter into existing vector and exact retrieval paths. This slice remains rule-based and does not add another LLM call before retrieval.

**Tech Stack:** Convex `^1.39.1`, React `^19.2.6`, Astro `^6.3.3`, TypeScript `^6.0.3`, Vitest `^4.1.6`, Bun.

---

## Research Notes

- Convex project pin and current npm stable: `1.39.1`, published May 15, 2026. Source: https://www.npmjs.com/package/convex
- Convex upstream changelog crawl exposed detailed notes through `1.36.1`; no API in this plan depends on changelog-only features after the project pin. Source: https://github.com/get-convex/convex-backend/blob/main/npm-packages/convex/CHANGELOG.md
- Convex vector search docs: vector search runs only inside actions; filters must use fields declared in `vectorIndex.filterFields`; search returns `_id` and `_score`, and documents must be loaded by a query or mutation. Source: https://docs.convex.dev/vector-search
- Convex validation docs: public functions should validate args and returns; `returns` validators reject extra fields and protect runtime boundaries. Source: https://docs.convex.dev/functions/validation
- React project pin: `^19.2.6`; React 19 requires modern JSX transform and recommends Testing Library instead of `react-test-renderer`. Sources: https://react.dev/blog/2025/10/01/react-19-2 and https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- Vitest project pin: `^4.1.6`; project already uses Vitest with direct handler tests for Convex functions and Testing Library for React components. Source: https://github.com/vitest-dev/vitest/compare/v4.1.5...v4.1.6

Key constraints for this plan:

- Keep `ctx.vectorSearch` inside `action` handlers.
- Continue using internal queries to load vector-search results.
- Keep validators explicit for any changed public or internal function return shape.
- Do not introduce a pre-retrieval LLM classifier in this slice.
- Preserve safe refusal behavior when evidence is empty or unsupported.

## File Structure

- Modify `convex/lib/validators.ts` to add `needs_clarification` to the shared answerability status validator.
- Modify `convex/lib/answerPacket.ts` to add optional `interpretedProblem` and `clarifyingQuestion` fields plus a `buildClarificationPacket` helper.
- Modify `convex/lib/answerPacket.test.ts` to cover clarification packets.
- Modify `convex/chats.ts` to reuse the shared answerability status validator for saved assistant messages.
- Modify `src/entities/chat/model/types.ts` to expose `needs_clarification` to React.
- Modify `src/features/ask-assistant/ui/AnswerPacketView.tsx` to render clarification status and question text.
- Modify `src/features/ask-assistant/ui/AnswerPacketView.test.tsx` to cover clarification rendering.
- Create `convex/lib/diagnosticQuery.ts` for pure diagnostic parsing, scope detection, and clarification decision logic.
- Create `convex/lib/diagnosticQuery.test.ts` for deterministic query-understanding coverage.
- Modify `convex/search.ts` to load ready document scopes, short-circuit ambiguous diagnostic questions, and pass retrieval scope into vector/exact loading.
- Modify `convex/search.ask.test.ts` to verify clarification short-circuit and scoped retrieval behavior.
- Modify `convex/search.loadResults.test.ts` to verify scoped vector result loading filters wrong vendor/product rows.
- Modify `convex/search.loadExactResults.test.ts` to verify exact term retrieval respects scope.
- Modify `convex/lib/evaluationSeed.ts` to add multi-vendor diagnostic evaluation cases.
- Modify `convex/lib/evaluationSeed.test.ts` to validate the new seed categories and slugs.
- Modify `convex/schema.ts` to persist optional expected answerability status for evaluation cases.
- Modify `convex/evaluations.ts` to include optional expected answerability status in the internal list validator.

## Task 1: Extend Answer Contract For Clarification

**Files:**

- Modify: `convex/lib/validators.ts`
- Modify: `convex/lib/answerPacket.ts`
- Modify: `convex/lib/answerPacket.test.ts`
- Modify: `convex/chats.ts`
- Modify: `src/entities/chat/model/types.ts`
- Modify: `src/features/ask-assistant/ui/AnswerPacketView.tsx`
- Modify: `src/features/ask-assistant/ui/AnswerPacketView.test.tsx`

- [ ] **Step 1: Write the failing backend answer-packet test**

Append this test block to `convex/lib/answerPacket.test.ts` and update the import to include `buildClarificationPacket`.

```ts
import { buildClarificationPacket, buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./answerPacket"

describe("buildClarificationPacket", () => {
  it("returns a citation-free packet that asks one focused follow-up question", () => {
    expect(
      buildClarificationPacket(
        "chatSessions_1" as never,
        "access-token-1",
        "Installation fault F002 after first power-on.",
        "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter."
      )
    ).toEqual({
      answerSteps: [],
      answerSummary: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
      answerabilityStatus: "needs_clarification",
      citations: [],
      clarifyingQuestion: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
      interpretedProblem: "Installation fault F002 after first power-on.",
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1",
      supportingAssets: []
    })
  })
})
```

- [ ] **Step 2: Run the backend answer-packet test and confirm it fails**

Run: `bun test convex/lib/answerPacket.test.ts`

Expected: FAIL because `buildClarificationPacket` is not exported and `needs_clarification` is not accepted by the answer packet validator.

- [ ] **Step 3: Write the failing React clarification rendering test**

Append this test to `src/features/ask-assistant/ui/AnswerPacketView.test.tsx`.

```tsx
it("renders clarification packets without evidence controls", () => {
  render(
    <AnswerPacketView
      packet={{
        answerabilityStatus: "needs_clarification",
        answerSummary: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
        answerSteps: [],
        citations: [],
        clarifyingQuestion: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
        interpretedProblem: "Installation fault F002 after first power-on.",
        supportingAssets: []
      }}
      onSelectCitation={vi.fn()}
    />
  )

  expect(screen.getByText("Clarification Required")).toBeInTheDocument()
  expect(screen.getByText("Installation fault F002 after first power-on.")).toBeInTheDocument()
  expect(
    screen.getByText("Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.")
  ).toBeInTheDocument()
})
```

- [ ] **Step 4: Run the React test and confirm it fails**

Run: `bun test src/features/ask-assistant/ui/AnswerPacketView.test.tsx`

Expected: FAIL because the frontend answerability type does not include `needs_clarification` and the component does not render a clarification label.

- [ ] **Step 5: Extend shared validators and answer packet helper**

Change `convex/lib/validators.ts` answerability status to this exact union.

```ts
export const answerabilityStatusValidator = v.union(
  v.literal("grounded"),
  v.literal("insufficient_evidence"),
  v.literal("needs_clarification")
)
```

Update `convex/lib/answerPacket.ts` with these changes.

```ts
export type AnswerPacket = {
  answerSteps: string[]
  answerSummary: string
  answerabilityStatus: "grounded" | "insufficient_evidence" | "needs_clarification"
  citations: AnswerCitation[]
  clarifyingQuestion?: string
  interpretedProblem?: string
  sessionAccessToken: string
  sessionId: GenericId<"chatSessions">
  supportingAssets: SupportingAsset[]
}

export const answerPacketValidator = v.object({
  answerSteps: v.array(v.string()),
  answerSummary: v.string(),
  answerabilityStatus: answerabilityStatusValidator,
  citations: v.array(answerCitationValidator),
  clarifyingQuestion: v.optional(v.string()),
  interpretedProblem: v.optional(v.string()),
  sessionAccessToken: v.string(),
  sessionId: v.id("chatSessions"),
  supportingAssets: v.array(supportingAssetValidator)
})

export function buildClarificationPacket(
  sessionId: GenericId<"chatSessions">,
  sessionAccessToken: string,
  interpretedProblem: string,
  clarifyingQuestion: string
): AnswerPacket {
  return {
    answerSteps: [],
    answerSummary: clarifyingQuestion,
    answerabilityStatus: "needs_clarification",
    citations: [],
    clarifyingQuestion,
    interpretedProblem,
    sessionAccessToken,
    sessionId,
    supportingAssets: []
  }
}
```

- [ ] **Step 6: Reuse the shared validator in chat message writes**

Change the imports and `appendMessage` args in `convex/chats.ts`.

```ts
import { answerabilityStatusValidator, messageRoleValidator } from "./lib/validators"

export const appendMessage = internalMutation({
  args: {
    answerabilityStatus: v.optional(answerabilityStatusValidator),
    content: v.string(),
    role: messageRoleValidator,
    sessionId: v.id("chatSessions")
  },
  returns: v.id("chatMessages"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("chatSessions", args.sessionId)
    if (!session) {
      throw new ConvexError("Session not found")
    }

    const now = Date.now()
    const messageId = await ctx.db.insert("chatMessages", {
      answerabilityStatus: args.answerabilityStatus,
      content: args.content,
      createdAt: now,
      role: args.role,
      sessionId: args.sessionId
    })

    await ctx.db.patch("chatSessions", args.sessionId, { updatedAt: now })
    return messageId
  }
})
```

- [ ] **Step 7: Extend frontend chat types and rendering**

Replace `src/entities/chat/model/types.ts` with this content.

```ts
export type AnswerabilityStatus = "grounded" | "insufficient_evidence" | "needs_clarification"
```

Update `src/features/ask-assistant/ui/AnswerPacketView.tsx` packet type and initial component body.

```tsx
export type AnswerPacketViewPacket = {
  answerabilityStatus: AnswerabilityStatus
  answerSummary: string
  answerSteps: string[]
  citations: Citation[]
  clarifyingQuestion?: string
  interpretedProblem?: string
  supportingAssets: SupportingAsset[]
}

function statusLabel(status: AnswerabilityStatus) {
  if (status === "needs_clarification") {
    return "Clarification Required"
  }

  if (status === "insufficient_evidence") {
    return "Insufficient Evidence"
  }

  return "Grounded Answer"
}

export default function AnswerPacketView({ packet, onSelectCitation }: AnswerPacketViewProps) {
  return (
    <section className="relative flex flex-col bg-white">
      <div className="space-y-6 p-6">
        <div className="wire-border inline-flex px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-[#000000] uppercase">
          {statusLabel(packet.answerabilityStatus)}
        </div>

        {packet.interpretedProblem ? (
          <div className="wire-border bg-[#FAFAFA] p-4">
            <h4 className="mb-2 font-mono text-[10px] tracking-[0.2em] text-[#555555] uppercase">Interpreted Problem</h4>
            <p className="font-mono text-[13px] leading-relaxed text-[#000000]">{packet.interpretedProblem}</p>
          </div>
        ) : null}

        <p className="font-mono text-[16px] leading-[1.8] whitespace-pre-wrap text-[#000000]">{packet.answerSummary}</p>
```

Keep the existing `answerSteps`, `citations`, and `supportingAssets` rendering below the new header block.

- [ ] **Step 8: Run task tests and confirm they pass**

Run: `bun test convex/lib/answerPacket.test.ts src/features/ask-assistant/ui/AnswerPacketView.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit the answer-contract slice**

```bash
git add convex/lib/validators.ts convex/lib/answerPacket.ts convex/lib/answerPacket.test.ts convex/chats.ts src/entities/chat/model/types.ts src/features/ask-assistant/ui/AnswerPacketView.tsx src/features/ask-assistant/ui/AnswerPacketView.test.tsx
git commit -m "feat(search): add clarification answer status"
```

## Task 2: Add Diagnostic Query Understanding Helper

**Files:**

- Create: `convex/lib/diagnosticQuery.ts`
- Create: `convex/lib/diagnosticQuery.test.ts`

- [ ] **Step 1: Write the failing diagnostic helper tests**

Create `convex/lib/diagnosticQuery.test.ts` with this content.

```ts
import { describe, expect, it } from "vitest"

import { buildClarifyingQuestion, hasDiagnosticSignals, understandDiagnosticQuery } from "./diagnosticQuery"

const scopes = [
  {
    documentId: "documents_1",
    language: "English",
    productSlug: "sinamics-g120",
    title: "SINAMICS G120 Operating Instructions",
    vendorSlug: "siemens",
    version: "v1"
  },
  {
    documentId: "documents_2",
    language: "English",
    productSlug: "powerflex-755",
    title: "PowerFlex 755 User Manual",
    vendorSlug: "rockwell-automation",
    version: "v2"
  }
]

describe("hasDiagnosticSignals", () => {
  it("detects installation and fault narratives", () => {
    expect(hasDiagnosticSignals("Saya install drive baru, setelah power on muncul F002.")).toBe(true)
    expect(hasDiagnosticSignals("What does Rockwell Automation mean?")).toBe(false)
  })
})

describe("understandDiagnosticQuery", () => {
  it("requires vendor and model context for ambiguous operational fault codes", () => {
    const result = understandDiagnosticQuery("Saya install drive baru, setelah power on muncul F002. Motor belum jalan.", scopes)

    expect(result).toMatchObject({
      intent: "troubleshooting",
      severity: "operational",
      stage: "first_power_on",
      literalIdentifiers: ["F002"],
      missingContext: ["vendor", "model"],
      needsClarification: true,
      productCategory: "drive"
    })
  })

  it("resolves vendor and product scope when the question names a known document family", () => {
    const result = understandDiagnosticQuery("Siemens SINAMICS G120 F002 after first power on", scopes)

    expect(result).toMatchObject({
      intent: "troubleshooting",
      literalIdentifiers: ["G120", "F002"],
      missingContext: [],
      needsClarification: false,
      resolvedScope: {
        productSlug: "sinamics-g120",
        vendorSlug: "siemens"
      }
    })
  })

  it("does not force vendor scoping for explicit comparison questions", () => {
    const result = understandDiagnosticQuery("Compare F002 behavior between Siemens and Rockwell manuals", scopes)

    expect(result.intent).toBe("comparison")
    expect(result.needsClarification).toBe(false)
  })
})

describe("buildClarifyingQuestion", () => {
  it("asks one focused Indonesian follow-up when the original question is Indonesian", () => {
    const result = understandDiagnosticQuery("Saya install drive baru, setelah power on muncul F002.", scopes)

    expect(buildClarifyingQuestion(result, "id")).toBe(
      "Kode atau gejala tersebut dapat berbeda antar vendor dan model. Sebutkan vendor dan model produk agar saya bisa mengambil manual resmi yang tepat."
    )
  })
})
```

- [ ] **Step 2: Run the diagnostic helper test and confirm it fails**

Run: `bun test convex/lib/diagnosticQuery.test.ts`

Expected: FAIL because `convex/lib/diagnosticQuery.ts` does not exist.

- [ ] **Step 3: Implement the diagnostic helper**

Create `convex/lib/diagnosticQuery.ts` with this content.

```ts
export type DiagnosticIntent =
  | "lookup"
  | "installation_help"
  | "troubleshooting"
  | "wiring"
  | "configuration"
  | "specification"
  | "comparison"
  | "unknown"

export type DiagnosticSeverity = "informational" | "operational" | "safety-critical"

export type DiagnosticStage = "installation" | "first_power_on" | "commissioning" | "operation" | "maintenance" | "unknown"

export type MissingDiagnosticContext = "vendor" | "model"

export type DiagnosticDocumentScope = {
  documentId: string
  language: string
  productSlug: string
  title: string
  vendorSlug: string
  version: string
}

export type DiagnosticQueryUnderstanding = {
  intent: DiagnosticIntent
  interpretedProblem: string
  literalIdentifiers: string[]
  missingContext: MissingDiagnosticContext[]
  needsClarification: boolean
  productCategory: string | null
  resolvedScope: DiagnosticDocumentScope | null
  severity: DiagnosticSeverity
  stage: DiagnosticStage
  symptoms: string
}

const DIAGNOSTIC_KEYWORDS = [
  "alarm",
  "commission",
  "commissioning",
  "drive",
  "error",
  "fault",
  "install",
  "instal",
  "installation",
  "inverter",
  "motor",
  "parameter",
  "power on",
  "troubleshoot",
  "wiring"
]

const COMPARISON_KEYWORDS = ["bandingkan", "compare", "comparison", "difference", "perbedaan", "versus", "vs"]
const WIRING_KEYWORDS = ["terminal", "wire", "wiring", "kabel", "pengkabelan"]
const CONFIGURATION_KEYWORDS = ["config", "configure", "konfigurasi", "parameter", "setting"]
const INSTALLATION_KEYWORDS = ["install", "instal", "installation", "mount", "pasang"]
const FIRST_POWER_ON_KEYWORDS = ["first power", "first power on", "power on", "startup", "start-up"]
const DRIVE_KEYWORDS = ["drive", "inverter", "vfd"]

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{Pd}_/]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function includesAny(normalizedQuestion: string, keywords: string[]) {
  return keywords.some((keyword) => normalizedQuestion.includes(normalize(keyword)))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function slugMatchesQuestion(slug: string, normalizedQuestion: string) {
  const normalizedSlug = normalize(slug)
  const slugTokens = normalizedSlug.split(" ").filter(Boolean)
  if (normalizedSlug && normalizedQuestion.includes(normalizedSlug)) {
    return true
  }

  return slugTokens.length > 0 && slugTokens.every((token) => normalizedQuestion.includes(token))
}

export function extractLiteralIdentifiers(question: string) {
  const matches = question.match(/\b(?=[A-Z0-9-]*\d)[A-Z]{0,8}\d[A-Z0-9-]{1,12}\b/gi) ?? []
  return unique(matches.map((match) => match.toUpperCase()))
}

function detectIntent(question: string): DiagnosticIntent {
  const normalizedQuestion = normalize(question)
  if (includesAny(normalizedQuestion, COMPARISON_KEYWORDS)) {
    return "comparison"
  }

  if (includesAny(normalizedQuestion, WIRING_KEYWORDS)) {
    return "wiring"
  }

  if (includesAny(normalizedQuestion, CONFIGURATION_KEYWORDS)) {
    return "configuration"
  }

  if (includesAny(normalizedQuestion, INSTALLATION_KEYWORDS)) {
    return extractLiteralIdentifiers(question).length > 0 ? "troubleshooting" : "installation_help"
  }

  if (/\b(error|fault|alarm|trip|kode|code)\b/i.test(question)) {
    return "troubleshooting"
  }

  return extractLiteralIdentifiers(question).length > 0 ? "lookup" : "unknown"
}

function detectSeverity(intent: DiagnosticIntent) {
  if (intent === "wiring") {
    return "safety-critical" as const
  }

  if (intent === "installation_help" || intent === "troubleshooting" || intent === "configuration") {
    return "operational" as const
  }

  return "informational" as const
}

function detectStage(question: string): DiagnosticStage {
  const normalizedQuestion = normalize(question)
  if (includesAny(normalizedQuestion, FIRST_POWER_ON_KEYWORDS)) {
    return "first_power_on"
  }

  if (includesAny(normalizedQuestion, INSTALLATION_KEYWORDS)) {
    return "installation"
  }

  if (normalizedQuestion.includes("commission")) {
    return "commissioning"
  }

  return "unknown"
}

function detectProductCategory(question: string) {
  return includesAny(normalize(question), DRIVE_KEYWORDS) ? "drive" : null
}

function resolveScope(question: string, scopes: DiagnosticDocumentScope[]) {
  const normalizedQuestion = normalize(question)
  const matchingScopes = scopes.filter(
    (scope) =>
      slugMatchesQuestion(scope.vendorSlug, normalizedQuestion) || slugMatchesQuestion(scope.productSlug, normalizedQuestion)
  )
  const productMatch = matchingScopes.find(
    (scope) =>
      slugMatchesQuestion(scope.vendorSlug, normalizedQuestion) && slugMatchesQuestion(scope.productSlug, normalizedQuestion)
  )

  return productMatch ?? matchingScopes[0] ?? null
}

export function hasDiagnosticSignals(question: string) {
  const normalizedQuestion = normalize(question)
  return extractLiteralIdentifiers(question).length > 0 || includesAny(normalizedQuestion, DIAGNOSTIC_KEYWORDS)
}

export function understandDiagnosticQuery(
  question: string,
  scopes: DiagnosticDocumentScope[] = []
): DiagnosticQueryUnderstanding {
  const trimmedQuestion = question.trim()
  const intent = detectIntent(trimmedQuestion)
  const severity = detectSeverity(intent)
  const stage = detectStage(trimmedQuestion)
  const literalIdentifiers = extractLiteralIdentifiers(trimmedQuestion)
  const resolvedScope = resolveScope(trimmedQuestion, scopes)
  const productCategory = detectProductCategory(trimmedQuestion)
  const requiresScopedContext =
    intent !== "comparison" && (severity === "operational" || severity === "safety-critical" || literalIdentifiers.length > 0)
  const missingContext: MissingDiagnosticContext[] = []

  if (requiresScopedContext && !resolvedScope?.vendorSlug) {
    missingContext.push("vendor")
  }

  if (requiresScopedContext && !resolvedScope?.productSlug) {
    missingContext.push("model")
  }

  return {
    intent,
    interpretedProblem: trimmedQuestion,
    literalIdentifiers,
    missingContext,
    needsClarification: missingContext.length > 0,
    productCategory,
    resolvedScope,
    severity,
    stage,
    symptoms: trimmedQuestion
  }
}

export function buildClarifyingQuestion(context: DiagnosticQueryUnderstanding, languageCode: "en" | "id" | "same_as_question") {
  if (languageCode === "id") {
    if (context.missingContext.includes("vendor") || context.missingContext.includes("model")) {
      return "Kode atau gejala tersebut dapat berbeda antar vendor dan model. Sebutkan vendor dan model produk agar saya bisa mengambil manual resmi yang tepat."
    }

    return "Saya perlu satu detail tambahan sebelum mengambil manual resmi yang tepat."
  }

  if (context.missingContext.includes("vendor") || context.missingContext.includes("model")) {
    return "That code or symptom can differ by vendor and model. Provide the product vendor and model so I can use the correct official manual."
  }

  return "I need one more detail before selecting the correct official manual."
}
```

- [ ] **Step 4: Run the diagnostic helper test and confirm it passes**

Run: `bun test convex/lib/diagnosticQuery.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the diagnostic helper slice**

```bash
git add convex/lib/diagnosticQuery.ts convex/lib/diagnosticQuery.test.ts
git commit -m "feat(search): add diagnostic query parsing"
```

## Task 3: Add Scoped Result Loading

**Files:**

- Modify: `convex/search.ts`
- Modify: `convex/search.loadResults.test.ts`
- Modify: `convex/search.loadExactResults.test.ts`

- [ ] **Step 1: Write the failing vector-result scope test**

Append this test to `convex/search.loadResults.test.ts`.

```ts
it("filters loaded vector results by vendor and product scope", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      chunkId: "chunks_1" as never,
      documentId: "documents_1" as never,
      isCurrent: true
    })
    .mockResolvedValueOnce({
      _id: "chunks_1" as never,
      citationLabel: "Page 7",
      content: "PowerFlex fault text.",
      isCurrent: true,
      pageNumber: 7
    })
    .mockResolvedValueOnce({
      productSlug: "powerflex-755",
      sourceAssetId: "documentAssets_1" as never,
      status: "ready",
      vendorSlug: "rockwell-automation"
    })
    .mockResolvedValueOnce({
      chunkId: "chunks_2" as never,
      documentId: "documents_2" as never,
      isCurrent: true
    })
    .mockResolvedValueOnce({
      _id: "chunks_2" as never,
      citationLabel: "Page 12",
      content: "SINAMICS fault text.",
      isCurrent: true,
      pageNumber: 12
    })
    .mockResolvedValueOnce({
      productSlug: "sinamics-g120",
      sourceAssetId: "documentAssets_2" as never,
      status: "ready",
      vendorSlug: "siemens"
    })

  const results = await loadSearchResultsHandler._handler(
    {
      db: { get }
    } as never,
    {
      matches: [
        { _id: "chunkEmbeddings_1" as never, _score: 0.97 },
        { _id: "chunkEmbeddings_2" as never, _score: 0.95 }
      ],
      scope: {
        productSlug: "sinamics-g120",
        vendorSlug: "siemens"
      }
    }
  )

  expect(results).toEqual([
    {
      assetId: "documentAssets_2",
      citationLabel: "Page 12",
      chunkId: "chunks_2",
      content: "SINAMICS fault text.",
      pageNumber: 12,
      score: 0.95
    }
  ])
})
```

Update the test handler type near the top of `convex/search.loadResults.test.ts` so `args` accepts optional `scope`.

```ts
args: {
  matches: Array<{ _id: never; _score: number }>
  scope?: { productSlug?: string; vendorSlug?: string }
}
```

- [ ] **Step 2: Write the failing exact-result scope test**

Append this test to the `describe("loadGlobalExactResultsPage", ...)` block in `convex/search.loadExactResults.test.ts`.

```ts
it("filters global exact candidates by vendor and product scope", async () => {
  const db = makeDb(
    [],
    [
      [
        {
          _id: "chunks_1" as never,
          citationLabel: "Page 4",
          content: "F002 PowerFlex exact match.",
          documentId: "documents_1" as never,
          isCurrent: true,
          pageNumber: 4
        },
        {
          _id: "chunks_2" as never,
          citationLabel: "Page 9",
          content: "F002 SINAMICS exact match.",
          documentId: "documents_2" as never,
          isCurrent: true,
          pageNumber: 9
        }
      ]
    ]
  )

  const get = vi
    .fn()
    .mockResolvedValueOnce({
      productSlug: "powerflex-755",
      sourceAssetId: "documentAssets_1" as never,
      status: "ready",
      vendorSlug: "rockwell-automation"
    })
    .mockResolvedValueOnce({
      productSlug: "sinamics-g120",
      sourceAssetId: "documentAssets_2" as never,
      status: "ready",
      vendorSlug: "siemens"
    })

  const results = await loadGlobalExactResultsPageHandler._handler(
    {
      db: { ...db, get }
    } as never,
    {
      paginationOpts: {
        cursor: null,
        numItems: GLOBAL_EXACT_MATCH_PAGE_SIZE
      },
      scope: {
        productSlug: "sinamics-g120",
        vendorSlug: "siemens"
      }
    }
  )

  expect(results.page).toEqual([
    {
      assetId: "documentAssets_2",
      citationLabel: "Page 9",
      chunkId: "chunks_2",
      content: "F002 SINAMICS exact match.",
      pageNumber: 9
    }
  ])
})
```

Update the test handler type near the top of `convex/search.loadExactResults.test.ts` so `loadGlobalExactResultsPage` args accepts optional `scope`.

```ts
args: {
  paginationOpts: { cursor: string | null; numItems: number }
  scope?: { productSlug?: string; vendorSlug?: string }
}
```

- [ ] **Step 3: Run scoped loading tests and confirm they fail**

Run: `bun test convex/search.loadResults.test.ts convex/search.loadExactResults.test.ts`

Expected: FAIL because the internal queries do not accept a `scope` arg and do not filter loaded documents by vendor/product.

- [ ] **Step 4: Add scope validators and helpers to `convex/search.ts`**

Add this type and validators near the existing search result validators in `convex/search.ts`.

```ts
type SearchScope = {
  productSlug?: string
  vendorSlug?: string
}

const searchScopeValidator = v.object({
  productSlug: v.optional(v.string()),
  vendorSlug: v.optional(v.string())
})

const documentScopeValidator = v.object({
  documentId: v.id("documents"),
  language: v.string(),
  productSlug: v.string(),
  title: v.string(),
  vendorSlug: v.string(),
  version: v.string()
})

function documentMatchesScope(document: { productSlug: string; vendorSlug: string }, scope?: SearchScope) {
  if (scope?.vendorSlug && document.vendorSlug !== scope.vendorSlug) {
    return false
  }

  if (scope?.productSlug && document.productSlug !== scope.productSlug) {
    return false
  }

  return true
}
```

- [ ] **Step 5: Add ready document scope query**

Add this internal query to `convex/search.ts` before `loadSearchResults`.

```ts
export const loadReadyDocumentScopes = internalQuery({
  args: {},
  returns: v.array(documentScopeValidator),
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").collect()
    return documents
      .filter((document) => document.status === "ready")
      .map((document) => ({
        documentId: document._id,
        language: document.language,
        productSlug: document.productSlug,
        title: document.title,
        vendorSlug: document.vendorSlug,
        version: document.version
      }))
  }
})
```

- [ ] **Step 6: Apply scope filtering to vector result loading**

Change `loadSearchResults` args and document filtering in `convex/search.ts`.

```ts
export const loadSearchResults = internalQuery({
  args: {
    matches: v.array(
      v.object({
        _id: v.id("chunkEmbeddings"),
        _score: v.number()
      })
    ),
    scope: v.optional(searchScopeValidator)
  },
  returns: v.array(searchResultValidator),
  handler: async (ctx, args) => {
    const results: SearchResult[] = []

    for (const match of args.matches) {
      const embedding = await ctx.db.get(match._id)
      if (!embedding?.isCurrent) {
        continue
      }

      const chunk = await ctx.db.get(embedding.chunkId)
      if (!chunk?.isCurrent) {
        continue
      }

      const document = await ctx.db.get(embedding.documentId)
      if (!document || document.status !== "ready" || !documentMatchesScope(document, args.scope)) {
        continue
      }

      results.push({
        assetId: document.sourceAssetId,
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        score: match._score
      })
    }

    return results
  }
})
```

- [ ] **Step 7: Apply scope filtering to global exact result loading**

Change `loadGlobalExactResultsPage` args and document filtering in `convex/search.ts`.

```ts
export const loadGlobalExactResultsPage = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    scope: v.optional(searchScopeValidator)
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    page: v.array(exactSearchCandidateValidator)
  }),
  handler: async (ctx, args) => {
    const { continueCursor, isDone, page } = await ctx.db
      .query("chunks")
      .withIndex("by_current_and_content", (q) => q.eq("isCurrent", true))
      .paginate(args.paginationOpts)

    const candidates: ExactSearchCandidate[] = []
    for (const chunk of page) {
      const document = await ctx.db.get(chunk.documentId)
      if (!document || document.status !== "ready" || !documentMatchesScope(document, args.scope)) {
        continue
      }

      candidates.push({
        ...(document.sourceAssetId === undefined ? {} : { assetId: document.sourceAssetId }),
        citationLabel: chunk.citationLabel,
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber
      })
    }

    return {
      continueCursor,
      isDone,
      page: candidates
    }
  }
})
```

Change `loadGlobalExactResultsByTerms` args and document filtering in `convex/search.ts`.

```ts
export const loadGlobalExactResultsByTerms = internalQuery({
  args: {
    question: v.string(),
    scope: v.optional(searchScopeValidator),
    terms: v.array(v.string())
  },
  returns: v.array(searchResultValidator),
  handler: async (ctx, args) => {
    const seenChunkIds = new Set<string>()
    const candidates: ExactSearchCandidate[] = []

    for (const term of args.terms.slice(0, 12)) {
      const rows = await ctx.db
        .query("chunkTerms")
        .withIndex("by_term", (q) => q.eq("term", term))
        .take(GLOBAL_EXACT_TERM_LIMIT)

      for (const row of rows) {
        if (seenChunkIds.has(String(row.chunkId))) {
          continue
        }

        const chunk = await ctx.db.get(row.chunkId)
        if (!chunk?.isCurrent) {
          continue
        }

        const document = await ctx.db.get(chunk.documentId)
        if (!document || document.status !== "ready" || !documentMatchesScope(document, args.scope)) {
          continue
        }

        seenChunkIds.add(String(chunk._id))
        candidates.push({
          ...(document.sourceAssetId === undefined ? {} : { assetId: document.sourceAssetId }),
          citationLabel: chunk.citationLabel,
          chunkId: chunk._id,
          content: chunk.content,
          pageNumber: chunk.pageNumber
        })
      }
    }

    return rankExactSearchResults(args.question, candidates)
  }
})
```

- [ ] **Step 8: Run scoped loading tests and confirm they pass**

Run: `bun test convex/search.loadResults.test.ts convex/search.loadExactResults.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the scoped-loading slice**

```bash
git add convex/search.ts convex/search.loadResults.test.ts convex/search.loadExactResults.test.ts
git commit -m "feat(search): scope loaded evidence by vendor"
```

## Task 4: Integrate Diagnostic Clarification Into `search.ask`

**Files:**

- Modify: `convex/search.ts`
- Modify: `convex/search.ask.test.ts`

- [ ] **Step 1: Write the failing clarification short-circuit test**

Append this test to `convex/search.ask.test.ts`.

```ts
it("asks for vendor and model before provider calls for ambiguous installation fault codes", async () => {
  const runQuery = vi.fn().mockResolvedValueOnce([
    {
      documentId: "documents_1" as never,
      language: "English",
      productSlug: "sinamics-g120",
      title: "SINAMICS G120 Operating Instructions",
      vendorSlug: "siemens",
      version: "v1"
    }
  ])
  const runMutation = createRunMutation([
    { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
    { allowed: true },
    "chatMessages_1",
    "chatMessages_2"
  ])
  const vectorSearch = vi.fn().mockResolvedValue([])

  const packet = await askHandler._handler(
    {
      runMutation,
      runQuery,
      vectorSearch
    } as never,
    {
      question: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
      sessionId: undefined as never
    }
  )

  expect(packet.answerabilityStatus).toBe("needs_clarification")
  expect(packet.answerSummary).toMatch(/vendor dan model/i)
  expect(packet.citations).toEqual([])
  expect(embedSearchQuery).not.toHaveBeenCalled()
  expect(generateGroundedAnswer).not.toHaveBeenCalled()
  expect(vectorSearch).not.toHaveBeenCalled()
  expect(getMutationArgs(runMutation, "chats:appendMessage")).toEqual([
    {
      content: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
      role: "user",
      sessionId: "chatSessions_1"
    },
    {
      answerabilityStatus: "needs_clarification",
      content:
        "Kode atau gejala tersebut dapat berbeda antar vendor dan model. Sebutkan vendor dan model produk agar saya bisa mengambil manual resmi yang tepat.",
      role: "assistant",
      sessionId: "chatSessions_1"
    }
  ])
})
```

- [ ] **Step 2: Write the failing scoped retrieval integration test**

Append this test to `convex/search.ask.test.ts`.

```ts
it("passes detected vendor and product scope into retrieval for known multi-vendor fault questions", async () => {
  const runQuery = vi
    .fn()
    .mockResolvedValueOnce([
      {
        documentId: "documents_1" as never,
        language: "English",
        productSlug: "sinamics-g120",
        title: "SINAMICS G120 Operating Instructions",
        vendorSlug: "siemens",
        version: "v1"
      }
    ])
    .mockResolvedValueOnce([
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page 42",
        chunkId: "chunks_1" as never,
        content: "F002 troubleshooting instructions for SINAMICS G120.",
        pageNumber: 42,
        score: 0.93
      }
    ])
    .mockResolvedValueOnce([])

  const runMutation = createRunMutation([
    { sessionAccessToken: "access-token-1", sessionId: "chatSessions_1" },
    { allowed: true },
    "chatMessages_1",
    "chatMessages_2",
    null
  ])
  const vectorSearch = vi.fn().mockResolvedValue([{ _id: "chunkEmbeddings_1" as never, _score: 0.93 }])

  generateGroundedAnswer.mockResolvedValueOnce({
    answerSteps: ["Check the cited SINAMICS fault table."],
    answerSummary: "F002 is answered from the SINAMICS G120 evidence.",
    citationIds: ["E1"]
  })

  const packet = await askHandler._handler(
    {
      runMutation,
      runQuery,
      vectorSearch
    } as never,
    {
      question: "Siemens SINAMICS G120 F002 after first power on",
      sessionId: undefined as never
    }
  )

  expect(packet.answerabilityStatus).toBe("grounded")
  expect(runQuery).toHaveBeenNthCalledWith(2, expect.anything(), {
    matches: [{ _id: "chunkEmbeddings_1", _score: 0.93 }],
    scope: {
      productSlug: "sinamics-g120",
      vendorSlug: "siemens"
    }
  })
  expect(vectorSearch).toHaveBeenCalledWith(
    "chunkEmbeddings",
    "by_embedding",
    expect.objectContaining({
      limit: 6,
      vector: [0.1, 0.2]
    })
  )
})
```

- [ ] **Step 3: Run `ask` tests and confirm they fail**

Run: `bun test convex/search.ask.test.ts`

Expected: FAIL because `search.ask` does not load ready scopes, does not build diagnostic clarification packets, and does not pass scope into result loading.

- [ ] **Step 4: Update the `askHandler` return type in the test file**

Update the `askHandler` helper type near the top of `convex/search.ask.test.ts` so it can represent clarification packets.

```ts
  ) => Promise<{
    answerSteps: string[]
    answerSummary: string
    answerabilityStatus: "grounded" | "insufficient_evidence" | "needs_clarification"
    citations: Array<{ chunkId: never; pageNumber: number; citationLabel: string; assetId?: never }>
    clarifyingQuestion?: string
    interpretedProblem?: string
    sessionAccessToken: string
    sessionId: never
    supportingAssets: Array<{ assetId: never; label: string; pageNumber: number }>
  }>
```

- [ ] **Step 5: Import diagnostic helpers and clarification packet**

Update imports near the top of `convex/search.ts`.

```ts
import type { DiagnosticDocumentScope } from "./lib/diagnosticQuery"

import {
  answerPacketValidator,
  buildClarificationPacket,
  buildGroundedPacket,
  buildRefusalPacket,
  selectEvidenceByCitationIds
} from "./lib/answerPacket"
import { buildClarifyingQuestion, hasDiagnosticSignals, understandDiagnosticQuery } from "./lib/diagnosticQuery"
```

- [ ] **Step 6: Add vector filter helper to `convex/search.ts`**

Add this helper near `getTopEvidenceScore`.

```ts
function buildVectorSearchFilter(documentId: GenericId<"documents"> | undefined, scope: SearchScope | undefined) {
  return (q: { eq: (field: string, value: boolean | string) => unknown }) => {
    if (documentId) {
      return q.eq("documentCurrentKey", `${documentId}:current`)
    }

    if (scope?.vendorSlug) {
      return q.eq("vendorSlug", scope.vendorSlug)
    }

    return q.eq("isCurrent", true)
  }
}
```

- [ ] **Step 7: Add diagnostic preflight inside `ask` after saving the user message**

Insert this block immediately after the existing `await ctx.runMutation(internal.chats.appendMessage, { content: question, role: "user", sessionId })` call in `convex/search.ts`.

```ts
let retrievalScope: SearchScope | undefined
if (!args.documentId && hasDiagnosticSignals(question)) {
  const readyScopes = (await ctx.runQuery(internal.search.loadReadyDocumentScopes, {})) as DiagnosticDocumentScope[]
  const diagnosticContext = understandDiagnosticQuery(question, readyScopes)
  retrievalScope = diagnosticContext.resolvedScope
    ? {
        productSlug: diagnosticContext.resolvedScope.productSlug,
        vendorSlug: diagnosticContext.resolvedScope.vendorSlug
      }
    : undefined

  if (diagnosticContext.needsClarification) {
    const clarifyingQuestion = buildClarifyingQuestion(diagnosticContext, responseLanguage.code)
    const packet = buildClarificationPacket(
      sessionId,
      sessionAccessToken,
      diagnosticContext.interpretedProblem,
      clarifyingQuestion
    )

    await ctx.runMutation(internal.chats.appendMessage, {
      answerabilityStatus: packet.answerabilityStatus,
      content: packet.answerSummary,
      role: "assistant",
      sessionId
    })

    if (shouldRotateSessionToken) {
      packet.sessionAccessToken = (
        await ctx.runMutation(internal.chats.rotateSessionAccessToken, { sessionAccessToken, sessionId })
      ).sessionAccessToken
    }

    return packet
  }
}
```

- [ ] **Step 8: Pass retrieval scope into vector and exact paths**

Change the vector search call in `convex/search.ts`.

```ts
const matches = await ctx.vectorSearch("chunkEmbeddings", "by_embedding", {
  filter: buildVectorSearchFilter(args.documentId, retrievalScope),
  limit: getVectorSearchLimit(args.documentId),
  vector: embedding
})
```

Change the vector result loading call.

```ts
const evidence: SearchResult[] = await ctx.runQuery(internal.search.loadSearchResults, {
  matches,
  ...(retrievalScope === undefined ? {} : { scope: retrievalScope })
})
```

Change the term exact retrieval call.

```ts
              ? await ctx.runQuery(internal.search.loadGlobalExactResultsByTerms, {
                  question,
                  ...(retrievalScope === undefined ? {} : { scope: retrievalScope }),
                  terms
                })
```

Change the paginated exact retrieval call.

```ts
const page: ExactSearchPage = await ctx.runQuery(internal.search.loadGlobalExactResultsPage, {
  paginationOpts: {
    cursor,
    numItems
  },
  ...(retrievalScope === undefined ? {} : { scope: retrievalScope })
})
```

- [ ] **Step 9: Run `ask` tests and confirm they pass**

Run: `bun test convex/search.ask.test.ts`

Expected: PASS.

- [ ] **Step 10: Run search tests affected by changed internals**

Run: `bun test convex/search.test.ts convex/search.loadResults.test.ts convex/search.loadExactResults.test.ts convex/search.ask.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit the diagnostic ask slice**

```bash
git add convex/search.ts convex/search.ask.test.ts convex/search.test.ts convex/search.loadResults.test.ts convex/search.loadExactResults.test.ts
git commit -m "feat(search): clarify ambiguous diagnostics"
```

## Task 5: Add Multi-Vendor Diagnostic Evaluation Seeds

**Files:**

- Modify: `convex/lib/evaluationSeed.ts`
- Modify: `convex/lib/evaluationSeed.test.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/evaluations.ts`

- [ ] **Step 1: Read the current evaluation seed test**

Open `convex/lib/evaluationSeed.test.ts` and keep its existing assertions. Add the new tests below the existing cases.

- [ ] **Step 2: Write the failing seed coverage test**

Append this test to `convex/lib/evaluationSeed.test.ts`.

```ts
it("includes multi-vendor diagnostic ambiguity cases", () => {
  expect(defaultEvaluationCases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        category: "multi-vendor-clarification",
        expectedAnswerabilityStatus: "needs_clarification",
        expectedRefusal: true,
        severity: "operational",
        slug: "multi-vendor-f002-missing-scope"
      }),
      expect.objectContaining({
        category: "error-code-collision",
        expectedAnswerabilityStatus: "needs_clarification",
        expectedRefusal: true,
        severity: "operational",
        slug: "multi-vendor-error-code-collision"
      })
    ])
  )
})
```

- [ ] **Step 3: Run the seed test and confirm it fails**

Run: `bun test convex/lib/evaluationSeed.test.ts`

Expected: FAIL because the seed type and default cases do not include multi-vendor diagnostic fields.

- [ ] **Step 4: Extend the evaluation seed type and default cases**

Update `convex/lib/evaluationSeed.ts` with these type changes.

```ts
export type EvaluationCategory =
  | "exact-lookup"
  | "table-reasoning"
  | "diagram-reasoning"
  | "not-found"
  | "multi-vendor-clarification"
  | "error-code-collision"
  | "wrong-version-trap"
  | "safety-critical-instruction"

export type EvaluationSeed = {
  category: EvaluationCategory
  expectedAnswerabilityStatus?: "grounded" | "insufficient_evidence" | "needs_clarification"
  expectedDocumentTitle: string
  expectedPageNumbers: number[]
  expectedRefusal: boolean
  question: string
  severity: "informational" | "operational" | "safety-critical"
  slug: string
}
```

Append these objects to `defaultEvaluationCases`.

```ts
  {
    slug: "multi-vendor-f002-missing-scope",
    question: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
    category: "multi-vendor-clarification",
    severity: "operational",
    expectedAnswerabilityStatus: "needs_clarification",
    expectedDocumentTitle: "",
    expectedPageNumbers: [],
    expectedRefusal: true
  },
  {
    slug: "multi-vendor-error-code-collision",
    question: "What should I check for F002 after first power on?",
    category: "error-code-collision",
    severity: "operational",
    expectedAnswerabilityStatus: "needs_clarification",
    expectedDocumentTitle: "",
    expectedPageNumbers: [],
    expectedRefusal: true
  },
  {
    slug: "sinamics-g120-f002-scoped",
    question: "Siemens SINAMICS G120 F002 after first power on",
    category: "exact-lookup",
    severity: "operational",
    expectedAnswerabilityStatus: "grounded",
    expectedDocumentTitle: "SINAMICS G120 Operating Instructions",
    expectedPageNumbers: [],
    expectedRefusal: false
  }
```

- [ ] **Step 5: Persist the optional expected status in schema and list output**

Modify `convex/schema.ts` `evaluationCases` table definition.

```ts
  evaluationCases: defineTable({
    slug: v.string(),
    question: v.string(),
    category: v.string(),
    severity: severityValidator,
    expectedAnswerabilityStatus: v.optional(answerabilityStatusValidator),
    expectedDocumentTitle: v.string(),
    expectedPageNumbers: v.array(v.number()),
    expectedRefusal: v.boolean()
  }).index("by_slug", ["slug"]),
```

Modify `convex/evaluations.ts` `evaluationCaseValidator`.

```ts
const evaluationCaseValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("evaluationCases"),
  category: v.string(),
  expectedAnswerabilityStatus: v.optional(answerabilityStatusValidator),
  expectedDocumentTitle: v.string(),
  expectedPageNumbers: v.array(v.number()),
  expectedRefusal: v.boolean(),
  question: v.string(),
  severity: severityValidator,
  slug: v.string()
})
```

Update the import in `convex/evaluations.ts`.

```ts
import { answerabilityStatusValidator, severityValidator } from "./lib/validators"
```

- [ ] **Step 6: Run evaluation tests and confirm they pass**

Run: `bun test convex/lib/evaluationSeed.test.ts convex/evaluations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the evaluation slice**

```bash
git add convex/lib/evaluationSeed.ts convex/lib/evaluationSeed.test.ts convex/schema.ts convex/evaluations.ts convex/evaluations.test.ts
git commit -m "test(search): seed diagnostic rag cases"
```

## Task 6: Final Verification

**Files:**

- Verify all modified files from Tasks 1 through 5.

- [ ] **Step 1: Run targeted tests**

Run: `bun test convex/lib/answerPacket.test.ts convex/lib/diagnosticQuery.test.ts convex/search.loadResults.test.ts convex/search.loadExactResults.test.ts convex/search.ask.test.ts convex/lib/evaluationSeed.test.ts convex/evaluations.test.ts src/features/ask-assistant/ui/AnswerPacketView.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 3: Run mandatory lint/type verification**

Run: `bun run lint`

Expected: PASS with zero Biome, TypeScript, and Convex TypeScript errors.

- [ ] **Step 4: Inspect changed files**

Run: `git diff --stat`

Expected: Changes are limited to the files listed in this plan.

Run: `git diff -- docs/superpowers/specs/2026-05-18-multi-vendor-diagnostic-rag-design.md docs/superpowers/plans/2026-05-18-multi-vendor-diagnostic-rag.md convex src`

Expected: Diff shows the diagnostic RAG vertical slice, no unrelated formatting churn, and no secrets.

- [ ] **Step 5: Final commit after user approval**

```bash
git add convex src docs/superpowers/specs/2026-05-18-multi-vendor-diagnostic-rag-design.md docs/superpowers/plans/2026-05-18-multi-vendor-diagnostic-rag.md
git commit -m "feat(search): add diagnostic rag clarification"
```

## Self-Review Notes

- Spec coverage: The plan implements narrative query understanding, scoped vendor/product retrieval, clarification for missing context, literal retrieval preservation, structured answer status, and evaluation coverage.
- Scope boundary: The plan does not add autonomous actions, live device integrations, multi-agent orchestration, or a second LLM classifier.
- Type consistency: `needs_clarification` is added to backend validators, saved chat messages, answer packets, frontend types, and UI rendering.
- Retrieval consistency: Vector search remains in `search.ask`; document loading and filtering remain in internal queries.
- Verification: Targeted tests, full tests, and mandatory `bun run lint` are included before completion.
