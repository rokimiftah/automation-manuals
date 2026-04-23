# Critical Path Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four highest-risk runtime defects in grounding, admin session recovery, document readiness, and OCR fallback without widening scope into a broader refactor.

**Architecture:** Tighten the existing contracts instead of replacing them. The grounded-answer flow will move from “attach all retrieved evidence” to “attach only evidence explicitly selected by the model”; the admin UI will centralize local session invalidation; document activation will require explicit readiness validation; and the MinerU finalization path will run targeted OCR for fallback pages instead of bypassing that recovery path.

**Tech Stack:** Convex actions/queries/mutations, React 19 islands, Astro 6 shell, Vitest, Testing Library, Mistral chat/embedding/OCR helpers.

**Execution note:** Do not create git commits unless the user explicitly asks for them.

---

## File Structure

- Modify: `convex/lib/mistral.ts` - extend grounded-answer JSON contract to return `citationIds`
- Modify: `convex/lib/mistral.test.ts` - cover structured JSON parsing with `citationIds`
- Modify: `convex/lib/answerPacket.ts` - select evidence by model-returned identifiers, keep citation granularity, and build saved evidence from selected citations only
- Modify: `convex/lib/answerPacket.test.ts` - verify selected-evidence behavior and refusal fallback on invalid identifiers
- Modify: `convex/search.ts` - assign stable evidence IDs, validate selected evidence, and persist only selected rows
- Modify: `src/features/admin-auth/ui/AdminSessionGate.tsx` - centralize local admin session clearing, add local expiry handling, and make sign-out clear local state regardless of mutation success
- Modify: `src/features/admin-auth/ui/AdminSessionGate.test.tsx` - cover local expiry and sign-out cleanup behavior
- Modify: `src/widgets/admin-console/ui/AdminConsole.tsx` - route protected mutation auth failures through the shared local session invalidation path
- Create: `src/widgets/admin-console/ui/AdminConsole.test.tsx` - verify auth failures on protected admin mutations clear the session via callback
- Modify: `convex/lib/documentReadiness.ts` - add explicit readiness artifact validation helper
- Modify: `convex/lib/documentReadiness.test.ts` - verify readiness validation fails closed for missing artifacts
- Modify: `convex/documents.ts` - validate readiness before deactivating current content and before marking a document ready
- Modify: `convex/lib/parsedPage.ts` - allow parsed pages to retain an optional `needsOcrFallback` flag
- Modify: `convex/lib/normalize.ts` - preserve explicit fallback signals when they already exist
- Modify: `convex/lib/ingestDocument.ts` - allow OCR fallback in the parsed-pages branch when `ocr` and `sourceUrl` are supplied
- Modify: `convex/lib/ingestDocument.test.ts` - verify fallback pages use OCR while non-fallback pages skip it
- Modify: `convex/ingestion.ts` - pass `sourceUrl` and OCR dependency through the MinerU finalization path

### Task 1: Ground The Answer Packet To Selected Evidence

**Files:**
- Modify: `convex/lib/mistral.ts`
- Modify: `convex/lib/mistral.test.ts`
- Modify: `convex/lib/answerPacket.ts`
- Modify: `convex/lib/answerPacket.test.ts`
- Modify: `convex/search.ts`

- [ ] **Step 1: Write the failing packet-selection tests**

```ts
// convex/lib/answerPacket.test.ts
import { describe, expect, it } from "vitest"

import { buildGroundedPacket, buildRefusalPacket, selectEvidenceByCitationIds } from "./answerPacket"

const evidence = [
  {
    assetId: "documentAssets_1" as never,
    citationLabel: "Page 12",
    chunkId: "chunks_1" as never,
    evidenceId: "E1",
    pageNumber: 12,
    score: 0.97
  },
  {
    assetId: "documentAssets_1" as never,
    citationLabel: "Page 12",
    chunkId: "chunks_2" as never,
    evidenceId: "E2",
    pageNumber: 12,
    score: 0.95
  }
]

describe("selectEvidenceByCitationIds", () => {
  it("keeps only evidence explicitly selected by the model", () => {
    expect(selectEvidenceByCitationIds(evidence, ["E2"]))
      .toEqual([evidence[1]])
  })

  it("drops unknown identifiers so callers can refuse the answer", () => {
    expect(selectEvidenceByCitationIds(evidence, ["E9"]))
      .toEqual([])
  })
})

describe("buildGroundedPacket", () => {
  it("keeps citation granularity by chunk id instead of collapsing same-page chunks", () => {
    expect(
      buildGroundedPacket(
        "chatSessions_1" as never,
        "Install the module beside the controller.",
        ["Check the chassis"],
        evidence
      )
    ).toEqual({
      answerSteps: ["Check the chassis"],
      answerSummary: "Install the module beside the controller.",
      answerabilityStatus: "grounded",
      citations: [
        {
          assetId: "documentAssets_1",
          citationLabel: "Page 12",
          chunkId: "chunks_1",
          pageNumber: 12
        },
        {
          assetId: "documentAssets_1",
          citationLabel: "Page 12",
          chunkId: "chunks_2",
          pageNumber: 12
        }
      ],
      sessionId: "chatSessions_1",
      supportingAssets: [
        {
          assetId: "documentAssets_1",
          label: "Page 12",
          pageNumber: 12
        }
      ]
    })
  })
})
```

- [ ] **Step 2: Extend the Mistral contract test so it fails until `citationIds` are parsed**

```ts
// convex/lib/mistral.test.ts
describe("generateGroundedAnswer", () => {
  it("parses json mode content with explicit citation ids", async () => {
    const client = {
      chat: {
        complete: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: [
                  { text: '{"answerSummary":"Install the module beside the controller.","answerSteps":[' },
                  { text: '"Verify the mounting rail"],"citationIds":["E1"]}' }
                ]
              }
            }
          ]
        })
      }
    }

    await expect(
      generateGroundedAnswer("Where should the module go?", "[E1] Page 12: Install it next to the controller.", {
        client,
        model: "mistral-small-latest"
      })
    ).resolves.toEqual({
      answerSteps: ["Verify the mounting rail"],
      answerSummary: "Install the module beside the controller.",
      citationIds: ["E1"]
    })
  })
})
```

- [ ] **Step 3: Run the focused tests to verify the failures are real**

Run: `bunx vitest run convex/lib/answerPacket.test.ts convex/lib/mistral.test.ts`

Expected:
- `answerPacket.test.ts` fails because `selectEvidenceByCitationIds` does not exist and same-page citations are still deduplicated away
- `mistral.test.ts` fails because `generateGroundedAnswer` does not return `citationIds`

- [ ] **Step 4: Implement the minimal packet-selection helpers and JSON contract**

```ts
// convex/lib/answerPacket.ts
type Evidence = {
  assetId?: GenericId<"documentAssets">
  citationLabel: string
  chunkId: GenericId<"chunks">
  evidenceId: string
  pageNumber: number
  score: number
}

export function selectEvidenceByCitationIds(evidence: Evidence[], citationIds: string[]) {
  const wanted = new Set(citationIds.map((id) => id.trim()).filter(Boolean))
  return evidence.filter((item) => wanted.has(item.evidenceId))
}

export function buildGroundedPacket(
  sessionId: GenericId<"chatSessions">,
  answerSummary: string,
  answerSteps: string[],
  evidence: Evidence[]
): AnswerPacket {
  const citations = uniqueBy(evidence, (item) => item.chunkId).map((item) => ({
    ...(item.assetId === undefined ? {} : { assetId: item.assetId }),
    citationLabel: item.citationLabel,
    chunkId: item.chunkId,
    pageNumber: item.pageNumber
  }))

  const supportingAssets = uniqueBy(
    evidence.filter((item): item is Evidence & { assetId: GenericId<"documentAssets"> } => item.assetId !== undefined),
    (item) => `${item.pageNumber}:${item.assetId}`
  ).map((item) => ({
    assetId: item.assetId,
    label: item.citationLabel,
    pageNumber: item.pageNumber
  }))

  return {
    answerSteps,
    answerSummary,
    answerabilityStatus: "grounded",
    citations,
    sessionId,
    supportingAssets
  }
}
```

```ts
// convex/lib/mistral.ts
export async function generateGroundedAnswer(question: string, context: string, options: ProviderOptions = {}) {
  const client = (options.client ?? getMistralClient()) as MistralClientLike
  const model = options.model ?? getProviderEnv().mistralChatModel
  const response = await client.chat.complete({
    messages: [
      {
        content:
          "Use only the provided context. If the context is insufficient, say so and return an empty answerSteps array and an empty citationIds array. Return strict JSON with keys answerSummary, answerSteps, and citationIds.",
        role: "system"
      },
      {
        content: `Question: ${question}\n\nContext: ${context}`,
        role: "user"
      }
    ],
    model,
    responseFormat: { type: "json_object" }
  })

  return parseJsonResponse<{ answerSteps: string[]; answerSummary: string; citationIds: string[] }>(
    response.choices[0]?.message?.content
  )
}
```

- [ ] **Step 5: Thread evidence IDs through the search action and refuse empty selections**

```ts
// convex/search.ts (inside ask)
const evidence = await ctx.runQuery(internal.search.loadSearchResults, { matches })
const evidenceWithIds = evidence.map((item, index) => ({ ...item, evidenceId: `E${index + 1}` }))

const context = evidenceWithIds.map((item) => `[${item.evidenceId}] ${item.citationLabel}: ${item.content}`).join("\n\n")
const groundedAnswer = await generateGroundedAnswer(question, context)
const selectedEvidence = selectEvidenceByCitationIds(evidenceWithIds, groundedAnswer.citationIds)

const packet: AnswerPacket =
  groundedAnswer.answerSteps.length === 0 || selectedEvidence.length === 0
    ? buildRefusalPacket(sessionId)
    : buildGroundedPacket(sessionId, groundedAnswer.answerSummary, groundedAnswer.answerSteps, selectedEvidence)

if (packet.answerabilityStatus === "grounded") {
  await ctx.runMutation(internal.search.saveEvidence, {
    evidence: selectedEvidence.map((item) => ({
      ...(item.assetId === undefined ? {} : { assetId: item.assetId }),
      chunkId: item.chunkId,
      pageNumber: item.pageNumber,
      score: item.score
    })),
    messageId: assistantMessageId
  })
}
```

- [ ] **Step 6: Re-run the focused tests and then the full backend test suite**

Run: `bunx vitest run convex/lib/answerPacket.test.ts convex/lib/mistral.test.ts`

Expected: PASS

Run: `bunx vitest run convex/**/*.test.ts`

Expected: PASS

### Task 2: Recover Cleanly From Admin Session Expiry

**Files:**
- Modify: `src/features/admin-auth/ui/AdminSessionGate.tsx`
- Modify: `src/features/admin-auth/ui/AdminSessionGate.test.tsx`
- Modify: `src/widgets/admin-console/ui/AdminConsole.tsx`
- Create: `src/widgets/admin-console/ui/AdminConsole.test.tsx`

- [ ] **Step 1: Add failing admin-session gate tests for local expiry and sign-out cleanup**

```tsx
// src/features/admin-auth/ui/AdminSessionGate.test.tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("AdminSessionGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    signIn.mockReset()
    signOut.mockReset()
    useQuery.mockReset()
  })

  it("clears the stored token when the validated session expires locally", async () => {
    sessionStorage.setItem("adminSessionToken", "token-123")
    useQuery.mockReturnValue({ expiresAt: Date.now() + 1_000, username: "admin" })

    render(
      <AdminSessionGate>
        {() => <div>Admin console</div>}
      </AdminSessionGate>
    )

    await screen.findByText("Admin console")

    act(() => {
      vi.advanceTimersByTime(1_001)
    })

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBeNull())
    expect(screen.getByText(/session expired/i)).toBeInTheDocument()
  })

  it("clears local session state even when sign-out rejects", async () => {
    sessionStorage.setItem("adminSessionToken", "token-123")
    useQuery.mockReturnValue({ expiresAt: Date.now() + 60_000, username: "admin" })
    signOut.mockRejectedValue(new Error("Admin session expired"))

    render(
      <AdminSessionGate>
        {({ onSignOut }) => <button onClick={() => void onSignOut()}>Leave admin</button>}
      </AdminSessionGate>
    )

    fireEvent.click(await screen.findByRole("button", { name: /leave admin/i }))

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBeNull())
    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Add the failing admin-console auth-failure test**

```tsx
// src/widgets/admin-console/ui/AdminConsole.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const createDocument = vi.fn()
const enqueue = vi.fn()
const retryJob = vi.fn()
const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useMutation: (target: unknown) => {
    if (String(target).includes("documents:create")) return createDocument
    if (String(target).includes("ingestion:enqueue")) return enqueue
    return retryJob
  },
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

it("routes protected mutation auth failures through onSessionInvalid", async () => {
  useQuery.mockReturnValue([])
  createDocument.mockRejectedValue(new Error("Admin session expired"))
  const onSessionInvalid = vi.fn()

  render(
    <AdminConsole
      onSessionInvalid={onSessionInvalid}
      onSignOut={vi.fn()}
      sessionToken="token-123"
      username="admin"
    />
  )

  fireEvent.change(screen.getByLabelText(/vendor name/i), { target: { value: "Rockwell Automation" } })
  fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "GuardLogix" } })
  fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "GuardLogix Manual" } })
  fireEvent.change(screen.getByLabelText(/version/i), { target: { value: "20.01" } })
  fireEvent.change(screen.getByLabelText(/language/i), { target: { value: "English" } })
  fireEvent.change(screen.getByLabelText(/source url/i), { target: { value: "https://vendor.example/manual.pdf" } })
  fireEvent.click(screen.getByRole("button", { name: /queue document/i }))

  await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledWith("Admin session expired. Please sign in again."))
})
```

- [ ] **Step 3: Run the focused admin tests to verify they fail first**

Run: `bunx vitest run src/features/admin-auth/ui/AdminSessionGate.test.tsx src/widgets/admin-console/ui/AdminConsole.test.tsx`

Expected:
- `AdminSessionGate` tests fail because local expiry and sign-out cleanup are not implemented
- `AdminConsole` test fails because the component does not expose `onSessionInvalid` or catch admin auth failures

- [ ] **Step 4: Centralize local session clearing in the gate and make sign-out best-effort**

```tsx
// src/features/admin-auth/ui/AdminSessionGate.tsx
const STORAGE_KEY = "adminSessionToken"
const EXPIRED_MESSAGE = "Admin session expired. Please sign in again."

export function AdminSessionGate({ children }: { children: (session: {
  expiresAt: number
  onSessionInvalid: (message?: string) => void
  onSignOut: () => Promise<void>
  sessionToken: string
  username: string
}) => ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  const clearSession = (message?: string) => {
    sessionStorage.removeItem(STORAGE_KEY)
    setSessionToken(null)
    setError(message)
  }

  useEffect(() => {
    setSessionToken(sessionStorage.getItem(STORAGE_KEY))
  }, [])

  useEffect(() => {
    if (!sessionToken || !session) {
      return
    }

    const delay = session.expiresAt - Date.now()
    if (delay <= 0) {
      clearSession(EXPIRED_MESSAGE)
      return
    }

    const timeoutId = window.setTimeout(() => clearSession(EXPIRED_MESSAGE), delay)
    return () => window.clearTimeout(timeoutId)
  }, [session, sessionToken])

  useEffect(() => {
    if (sessionToken && session === null) {
      clearSession(EXPIRED_MESSAGE)
    }
  }, [session, sessionToken])

  return children({
    expiresAt: session.expiresAt,
    onSessionInvalid: (message = EXPIRED_MESSAGE) => clearSession(message),
    onSignOut: async () => {
      const token = sessionToken
      clearSession()
      try {
        await signOut({ sessionToken: token })
      } catch {
        // Local session state is already cleared; server revocation is best-effort.
      }
    },
    sessionToken,
    username: session.username
  })
}
```

- [ ] **Step 5: Route protected admin mutation failures through the gate-owned invalidation callback**

```tsx
// src/widgets/admin-console/ui/AdminConsole.tsx
function isAdminSessionError(error: unknown) {
  return error instanceof Error && /admin session/i.test(error.message)
}

export default function AdminConsole({
  onSessionInvalid,
  onSignOut,
  sessionToken,
  username
}: {
  onSessionInvalid: (message?: string) => void
  onSignOut: () => Promise<void>
  sessionToken: string
  username: string
}) {
  async function runProtectedMutation<T>(work: () => Promise<T>) {
    try {
      return await work()
    } catch (error) {
      if (isAdminSessionError(error)) {
        onSessionInvalid("Admin session expired. Please sign in again.")
      }
      throw error
    }
  }

  return (
    <DocumentRegistrationForm
      onSubmit={(values) =>
        runProtectedMutation(async () => {
          const documentId = await createDocument({ ...values, sessionToken })
          await enqueue({ documentId, sessionToken })
        })
      }
    />
    <IngestionJobList
      jobs={jobs}
      onRetry={(jobId) =>
        runProtectedMutation(async () => {
          await retryJob({ jobId, sessionToken })
        })
      }
    />
  )
}
```

- [ ] **Step 6: Re-run the focused admin tests**

Run: `bunx vitest run src/features/admin-auth/ui/AdminSessionGate.test.tsx src/widgets/admin-console/ui/AdminConsole.test.tsx`

Expected: PASS

### Task 3: Fail Closed Before Activating A Document

**Files:**
- Modify: `convex/lib/documentReadiness.ts`
- Modify: `convex/lib/documentReadiness.test.ts`
- Modify: `convex/documents.ts`

- [ ] **Step 1: Replace the current readiness tests with fail-closed expectations**

```ts
// convex/lib/documentReadiness.test.ts
import { describe, expect, it } from "vitest"

import { assertReadyDocumentArtifacts, buildReadyDocumentPatch } from "./documentReadiness"

describe("assertReadyDocumentArtifacts", () => {
  it("throws when the source asset is missing", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasSourceAsset: false,
        pageCount: 1
      })
    ).toThrow("A current source asset is required before a document can become ready")
  })

  it("throws when no parsed pages were produced", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasSourceAsset: true,
        pageCount: 0
      })
    ).toThrow("At least one parsed page is required before a document can become ready")
  })

  it("throws when no searchable chunks were produced", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 0,
        hasSourceAsset: true,
        pageCount: 1
      })
    ).toThrow("At least one searchable chunk is required before a document can become ready")
  })
})

describe("buildReadyDocumentPatch", () => {
  it("returns the ready patch once the required artifacts exist", () => {
    expect(buildReadyDocumentPatch({ now: 5_678, sourceAssetId: "asset-1" as never })).toEqual({
      isActive: true,
      sourceAssetId: "asset-1",
      status: "ready",
      updatedAt: 5_678
    })
  })
})
```

- [ ] **Step 2: Run the readiness tests to verify the new failures**

Run: `bunx vitest run convex/lib/documentReadiness.test.ts`

Expected: FAIL because `assertReadyDocumentArtifacts` does not exist yet

- [ ] **Step 3: Implement the readiness assertion helper**

```ts
// convex/lib/documentReadiness.ts
import type { GenericId } from "convex/values"

export function assertReadyDocumentArtifacts(input: {
  chunkCount: number
  hasSourceAsset: boolean
  pageCount: number
}) {
  if (!input.hasSourceAsset) {
    throw new Error("A current source asset is required before a document can become ready")
  }

  if (input.pageCount < 1) {
    throw new Error("At least one parsed page is required before a document can become ready")
  }

  if (input.chunkCount < 1) {
    throw new Error("At least one searchable chunk is required before a document can become ready")
  }
}

export function buildReadyDocumentPatch(input: { now: number; sourceAssetId: GenericId<"documentAssets"> }) {
  return {
    isActive: true,
    sourceAssetId: input.sourceAssetId,
    status: "ready" as const,
    updatedAt: input.now
  }
}
```

- [ ] **Step 4: Call the readiness helper before deactivating current content and before `markReady` patches a document**

```ts
// convex/documents.ts (inside replaceParsedContent)
assertReadyDocumentArtifacts({
  chunkCount: args.chunks.length,
  hasSourceAsset: true,
  pageCount: args.pages.length
})

// keep the current-content deactivation below this check
```

```ts
// convex/documents.ts (inside markReady)
const [sourceAsset] = await ctx.db
  .query("documentAssets")
  .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
  .collect()

const pages = await ctx.db
  .query("documentPages")
  .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
  .collect()

const chunks = await ctx.db
  .query("chunks")
  .withIndex("by_document_and_current", (q) => q.eq("documentId", args.documentId).eq("isCurrent", true))
  .collect()

assertReadyDocumentArtifacts({
  chunkCount: chunks.length,
  hasSourceAsset: sourceAsset !== undefined,
  pageCount: pages.length
})

await ctx.db.patch(args.documentId, buildReadyDocumentPatch({
  now: Date.now(),
  sourceAssetId: sourceAsset._id
}))
```

- [ ] **Step 5: Re-run the readiness tests and then the document-related backend tests**

Run: `bunx vitest run convex/lib/documentReadiness.test.ts`

Expected: PASS

Run: `bunx vitest run convex/lib/documentReadiness.test.ts convex/lib/ingestionState.test.ts convex/lib/normalize.test.ts`

Expected: PASS

### Task 4: Execute OCR Fallback In The Real MinerU Finalization Path

**Files:**
- Modify: `convex/lib/parsedPage.ts`
- Modify: `convex/lib/normalize.ts`
- Modify: `convex/lib/ingestDocument.ts`
- Modify: `convex/lib/ingestDocument.test.ts`
- Modify: `convex/ingestion.ts`

- [ ] **Step 1: Add the failing parsed-pages OCR fallback tests**

```ts
// convex/lib/ingestDocument.test.ts
import { describe, expect, it, vi } from "vitest"

import { buildDocumentPayload } from "./ingestDocument"

describe("buildDocumentPayload", () => {
  it("runs OCR only for fallback pages in the parsed-pages branch", async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]])
    const ocr = vi.fn().mockResolvedValue("Recovered controller wiring instructions with enough text to be chunked safely.")

    await buildDocumentPayload({
      embed,
      ocr,
      parsedPages: [
        {
          markdown: "![image](https://cdn.example/page-1.png)",
          needsOcrFallback: true,
          pageNumber: 1
        },
        {
          markdown: "Install the module beside the controller and torque the rail screws before power-up.",
          needsOcrFallback: false,
          pageNumber: 2
        }
      ],
      sourceUrl: "https://vendor.example/manual.pdf"
    })

    expect(ocr).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledWith("https://vendor.example/manual.pdf", 1)
    expect(embed).toHaveBeenCalledWith([
      "Recovered controller wiring instructions with enough text to be chunked safely.",
      "Install the module beside the controller and torque the rail screws before power-up."
    ])
  })

  it("skips OCR for non-fallback provider pages", async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]])
    const ocr = vi.fn()

    await buildDocumentPayload({
      embed,
      ocr,
      parsedPages: [
        {
          markdown: "Install the module beside the controller and torque the rail screws before power-up.",
          needsOcrFallback: false,
          pageNumber: 2
        }
      ],
      sourceUrl: "https://vendor.example/manual.pdf"
    })

    expect(ocr).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the ingest-document tests to verify the fallback branch is currently missing**

Run: `bunx vitest run convex/lib/ingestDocument.test.ts`

Expected: FAIL because the parsed-pages branch does not invoke OCR today

- [ ] **Step 3: Allow parsed pages to retain fallback metadata and preserve it during normalization**

```ts
// convex/lib/parsedPage.ts
export type ParsedPage = {
  markdown: string
  needsOcrFallback?: boolean
  pageNumber: number
  printedPageNumber?: string
}
```

```ts
// convex/lib/normalize.ts
const normalizedPages = pages.map((page) => ({
  ...page,
  needsOcrFallback: page.needsOcrFallback ?? needsOcrFallback(page.markdown)
}))
```

- [ ] **Step 4: Run OCR in the parsed-pages branch when the caller provides `ocr` and `sourceUrl`**

```ts
// convex/lib/ingestDocument.ts
type ParsedPagesBuildDocumentPayloadArgs = {
  embed: (inputs: string[]) => Promise<number[][]>
  ocr?: (sourceUrl: string, pageNumber: number) => Promise<string>
  parsedPages: ParsedPage[]
  sourceUrl?: string
}

export async function buildDocumentPayload(args: BuildDocumentPayloadArgs) {
  const parsedPages = hasParsedPages(args) ? args.parsedPages : await args.parse()
  const initial = normalizeParsedPages(parsedPages)
  const canUseOcr = args.ocr !== undefined && args.sourceUrl !== undefined

  const pages = await Promise.all(
    initial.pages.map(async (page) => ({
      pageNumber: page.pageNumber,
      printedPageNumber: page.printedPageNumber,
      markdown:
        page.needsOcrFallback && canUseOcr
          ? await args.ocr(args.sourceUrl, page.pageNumber)
          : page.markdown
    }))
  )

  const normalized = normalizeParsedPages(pages)
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

- [ ] **Step 5: Pass OCR through the real MinerU finalization path**

```ts
// convex/ingestion.ts
import { embedTexts, ocrPdfPage } from "./lib/mistral"

const document = await ctx.runQuery(internal.documents.getById, { documentId: args.documentId })
if (!document) {
  await ctx.runMutation(internal.documents.markFailed, {
    errorMessage: "Document not found",
    jobId: args.jobId,
    documentId: args.documentId
  })
  return null
}

const payload = await buildDocumentPayload({
  embed: (inputs) => embedTexts(inputs),
  ocr: (sourceUrl, pageNumber) => ocrPdfPage(sourceUrl, pageNumber),
  parsedPages: normalized.pages,
  sourceUrl: document.sourceUrl
})
```

- [ ] **Step 6: Re-run the ingest-document tests and then the ingestion-related backend tests**

Run: `bunx vitest run convex/lib/ingestDocument.test.ts`

Expected: PASS

Run: `bunx vitest run convex/lib/ingestDocument.test.ts convex/lib/mineruResult.test.ts convex/lib/mineru.test.ts convex/lib/mineruCallback.test.ts`

Expected: PASS

### Task 5: Full Verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run the entire test suite**

Run: `bun run test`

Expected: PASS

- [ ] **Step 2: Run lint, formatting, and type verification**

Run: `bun run lint`

Expected: PASS with no type errors and no Biome issues

- [ ] **Step 3: Compare the result against the approved spec**

Check:
- answer packets now include only selected evidence
- admin session expiry clears local state and returns `/admin` to login behavior
- documents do not activate without source asset, pages, and chunks
- MinerU finalization now uses targeted OCR fallback on flagged pages

- [ ] **Step 4: Prepare the user-facing summary**

Include:
- files changed
- tests added or updated
- verification commands and outputs
- any remaining deferred medium-severity items
