# Automation Manuals SP1 Platform Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first end-to-end slice of Automation Manuals: auth, admin-curated document intake, ingestion, grounded retrieval, citations, and an engineer split-screen viewer.

**Architecture:** Astro serves route shells in hybrid mode while React islands power auth, admin, and engineer interactions. Convex stores operational state, file references, chunks, embeddings, sessions, and evaluation seeds; external parsing, OCR, embeddings, and answer generation run in Convex actions through provider adapters.

**Tech Stack:** Astro 6, React 19, Convex 1.x, Convex Auth beta, Tailwind CSS v4, Bun, Vitest, Testing Library, Llama Cloud TypeScript SDK, Mistral TypeScript SDK

---

## Prerequisites

- Run `bun install`
- Keep `bun run convex:dev` running in a separate terminal while implementing to regenerate `convex/_generated/*`
- Use a dedicated worktree before execution
- Set Convex deployment env vars before auth and ingestion tasks:
  - `SITE_URL=http://localhost:3000`
  - `AUTH_RESEND_KEY=<resend-api-key>`
  - `AUTH_EMAIL_FROM=<verified-from-email>`
  - `ADMIN_EMAILS=<comma-separated-admin-emails>`
  - `ALLOWED_EMAILS=<comma-separated-allowed-emails>`
  - `ALLOWED_EMAIL_DOMAINS=<comma-separated-domains>`
  - `LLAMA_CLOUD_API_KEY=<llama-cloud-key>`
  - `MISTRAL_API_KEY=<mistral-key>`
  - `MISTRAL_CHAT_MODEL=mistral-small-latest`
  - `MISTRAL_EMBED_MODEL=mistral-embed`

## File Structure

Root and tooling:

- Modify: `package.json` - add auth, provider SDK, and test dependencies plus `test` scripts
- Modify: `astro.config.mjs` - expose `CONVEX_SITE_URL` to client code
- Modify: `tsconfig.json` - add `skipLibCheck`
- Modify: `.env.local.example` - document local frontend envs
- Create: `vitest.config.ts` - test runner and aliases
- Create: `src/test/setup.ts` - Testing Library setup
- Create: `src/shared/config/env.ts` - validated public env access helper
- Test: `src/shared/config/env.test.ts`

Convex auth and access control:

- Modify: `convex/schema.ts`
- Create: `convex/auth.config.ts`
- Create: `convex/auth.ts`
- Create: `convex/http.ts`
- Create: `convex/lib/roles.ts`
- Create: `convex/lib/viewer.ts`
- Create: `convex/users.ts`
- Create: `src/app/providers/ConvexProvider.tsx`
- Create: `src/entities/auth/model/types.ts`
- Test: `convex/lib/roles.test.ts`

Convex domain and ingestion:

- Modify: `convex/schema.ts`
- Create: `convex/lib/validators.ts`
- Create: `convex/lib/ingestionState.ts`
- Create: `convex/documents.ts`
- Create: `convex/ingestion.ts`
- Create: `convex/assets.ts`
- Create: `convex/lib/env.ts`
- Create: `convex/lib/llamaCloud.ts`
- Create: `convex/lib/mistral.ts`
- Create: `convex/lib/normalize.ts`
- Create: `convex/lib/ingestDocument.ts`
- Test: `convex/lib/ingestionState.test.ts`
- Test: `convex/lib/normalize.test.ts`
- Test: `convex/lib/ingestDocument.test.ts`

Convex search and chat:

- Create: `convex/chats.ts`
- Create: `convex/search.ts`
- Create: `convex/lib/answerPacket.ts`
- Test: `convex/lib/answerPacket.test.ts`

Astro routes and UI islands:

- Modify: `src/layouts/Layout.astro`
- Modify: `src/pages/index.astro`
- Create: `src/pages/auth.astro`
- Create: `src/pages/app/index.astro`
- Create: `src/pages/admin/index.astro`
- Create: `src/features/auth/ui/AuthScreen.tsx`
- Create: `src/features/auth/ui/AuthGate.tsx`
- Create: `src/features/auth/ui/RoleGate.tsx`
- Create: `src/features/auth/ui/SignOutButton.tsx`
- Create: `src/features/auth/ui/index.ts`
- Create: `src/features/auth/island.tsx`
- Create: `src/widgets/app-shell/ui/AppShell.tsx`
- Create: `src/widgets/app-shell/index.ts`
- Create: `src/features/admin-ingestion/ui/DocumentRegistrationForm.tsx`
- Create: `src/features/admin-ingestion/ui/IngestionJobList.tsx`
- Create: `src/features/admin-ingestion/ui/index.ts`
- Create: `src/widgets/admin-console/ui/AdminConsole.tsx`
- Create: `src/widgets/admin-console/island.tsx`
- Create: `src/widgets/admin-console/index.ts`
- Create: `src/entities/chat/model/types.ts`
- Create: `src/entities/knowledge/model/types.ts`
- Create: `src/features/ask-assistant/ui/QuestionComposer.tsx`
- Create: `src/features/ask-assistant/ui/AnswerPacketView.tsx`
- Create: `src/features/ask-assistant/ui/index.ts`
- Create: `src/features/view-evidence/ui/EvidenceViewer.tsx`
- Create: `src/features/view-evidence/ui/index.ts`
- Create: `src/widgets/engineer-workspace/ui/EngineerWorkspace.tsx`
- Create: `src/widgets/engineer-workspace/island.tsx`
- Create: `src/widgets/engineer-workspace/index.ts`
- Test: `src/features/auth/ui/AuthScreen.test.tsx`
- Test: `src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx`
- Test: `src/features/ask-assistant/ui/AnswerPacketView.test.tsx`

Evaluation support:

- Create: `convex/evaluations.ts`
- Create: `convex/lib/evaluationSeed.ts`
- Test: `convex/lib/evaluationSeed.test.ts`
- Create: `docs/testing/sp1-manual-qa.md`

### Task 1: Tooling and Runtime Foundation

**Files:**

- Modify: `package.json`
- Modify: `astro.config.mjs`
- Modify: `tsconfig.json`
- Modify: `.env.local.example`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/shared/config/env.ts`
- Test: `src/shared/config/env.test.ts`

- [ ] **Step 1: Install auth, provider, and test dependencies**

Run:

```bash
bun add @auth/core @convex-dev/auth @llamaindex/llama-cloud @mistralai/mistralai
bun add -d vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: Bun updates `package.json` and `bun.lock` without peer dependency failures.

- [ ] **Step 2: Add a failing env test and test harness**

```ts
// vitest.config.ts
import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@app": path.resolve(__dirname, "./src/app"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@widgets": path.resolve(__dirname, "./src/widgets"),
      "@entities": path.resolve(__dirname, "./src/entities"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@convex": path.resolve(__dirname, "./convex")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "convex/**/*.test.ts"]
  }
})
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom/vitest"
```

```ts
// src/shared/config/env.test.ts
import { describe, expect, it } from "vitest"

import { getPublicAppEnv } from "./env"

describe("getPublicAppEnv", () => {
  it("returns normalized public Convex URLs", () => {
    expect(
      getPublicAppEnv({
        CONVEX_URL: "https://demo.convex.cloud",
        CONVEX_SITE_URL: "https://demo.convex.site"
      })
    ).toEqual({
      convexUrl: "https://demo.convex.cloud",
      convexSiteUrl: "https://demo.convex.site"
    })
  })

  it("throws when CONVEX_URL is missing", () => {
    expect(() => getPublicAppEnv({ CONVEX_URL: "", CONVEX_SITE_URL: "https://demo.convex.site" })).toThrow(
      "CONVEX_URL is required"
    )
  })
})
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run: `bunx vitest run src/shared/config/env.test.ts`

Expected: FAIL with `Cannot find module './env'` or `getPublicAppEnv is not exported`.

- [ ] **Step 4: Implement the env helper and project config updates**

```ts
// src/shared/config/env.ts
type PublicEnvInput = {
  CONVEX_URL?: string
  CONVEX_SITE_URL?: string
}

function requireValue(name: keyof PublicEnvInput, value?: string) {
  if (!value?.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

export function getPublicAppEnv(input: PublicEnvInput) {
  return {
    convexUrl: requireValue("CONVEX_URL", input.CONVEX_URL),
    convexSiteUrl: requireValue("CONVEX_SITE_URL", input.CONVEX_SITE_URL)
  }
}
```

```json
// package.json (scripts excerpt)
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "convex:dev": "convex dev",
    "convex:deploy": "convex deploy",
    "format": "prettier --write .",
    "lint": "biome check --write --unsafe . && tsc --noEmit && tsc --noEmit -p convex",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```ts
// astro.config.mjs (env excerpt)
env: {
  schema: {
    CONVEX_URL: envField.string({ access: "public", context: "client" }),
    CONVEX_SITE_URL: envField.string({ access: "public", context: "client" }),
  },
},
```

```json
// tsconfig.json (compilerOptions excerpt)
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "skipLibCheck": true
  }
}
```

```dotenv
# .env.local.example (excerpt)
CONVEX_DEPLOYMENT=
CONVEX_URL=
CONVEX_SITE_URL=
```

- [ ] **Step 5: Run tests and full repo verification**

Run:

```bash
bunx vitest run src/shared/config/env.test.ts
bun run lint
```

Expected: env test passes and `bun run lint` exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock astro.config.mjs tsconfig.json .env.local.example vitest.config.ts src/test/setup.ts src/shared/config/env.ts src/shared/config/env.test.ts
git commit -m "chore(sp1): add auth and test foundation"
```

### Task 2: Convex Auth and Viewer Access Boundary

**Files:**

- Modify: `convex/schema.ts`
- Create: `convex/auth.config.ts`
- Create: `convex/auth.ts`
- Create: `convex/http.ts`
- Create: `convex/lib/roles.ts`
- Create: `convex/lib/viewer.ts`
- Create: `convex/users.ts`
- Create: `src/app/providers/ConvexProvider.tsx`
- Create: `src/entities/auth/model/types.ts`
- Test: `convex/lib/roles.test.ts`

- [ ] **Step 1: Write the failing viewer-access test**

```ts
// convex/lib/roles.test.ts
import { describe, expect, it } from "vitest"

import { canManageDocuments, computeViewerAccess } from "./roles"

describe("computeViewerAccess", () => {
  it("marks listed admins as admins", () => {
    expect(
      computeViewerAccess("lead@example.com", {
        adminEmails: ["lead@example.com"],
        allowedEmails: [],
        allowedDomains: []
      })
    ).toEqual({ role: "admin", isAllowed: true, canManageDocuments: true })
  })

  it("blocks users outside the allowlist", () => {
    expect(
      computeViewerAccess("outsider@example.com", {
        adminEmails: [],
        allowedEmails: ["engineer@example.com"],
        allowedDomains: []
      })
    ).toEqual({ role: "engineer", isAllowed: false, canManageDocuments: false })
  })

  it("allows engineers from an approved domain", () => {
    expect(canManageDocuments("engineer")).toBe(false)
    expect(
      computeViewerAccess("tech@automation-manuals.internal", {
        adminEmails: [],
        allowedEmails: [],
        allowedDomains: ["automation-manuals.internal"]
      })
    ).toEqual({ role: "engineer", isAllowed: true, canManageDocuments: false })
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run convex/lib/roles.test.ts`

Expected: FAIL with `Cannot find module './roles'`.

- [ ] **Step 3: Implement manual Convex Auth wiring and viewer helpers**

```ts
// convex/auth.config.ts
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex"
    }
  ]
}
```

```ts
// convex/auth.ts
import Resend from "@auth/core/providers/resend"
import { Password } from "@convex-dev/auth/providers/Password"
import { convexAuth } from "@convex-dev/auth/server"

const resendMagicLink = Resend({
  id: "resend-magic-link",
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.AUTH_EMAIL_FROM
})

const resendPasswordReset = Resend({
  id: "resend-password-reset",
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.AUTH_EMAIL_FROM
})

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ reset: resendPasswordReset }), resendMagicLink]
})
```

```ts
// convex/http.ts
import { httpRouter } from "convex/server"

import { auth } from "./auth"

const http = httpRouter()

auth.addHttpRoutes(http)

export default http
```

```ts
// convex/lib/roles.ts
export type AppRole = "admin" | "engineer"

type AccessConfig = {
  adminEmails: string[]
  allowedEmails: string[]
  allowedDomains: string[]
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function splitCsv(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function readAccessConfig(): AccessConfig {
  return {
    adminEmails: splitCsv(process.env.ADMIN_EMAILS),
    allowedEmails: splitCsv(process.env.ALLOWED_EMAILS),
    allowedDomains: splitCsv(process.env.ALLOWED_EMAIL_DOMAINS)
  }
}

export function canManageDocuments(role: AppRole) {
  return role === "admin"
}

export function computeViewerAccess(email: string, config = readAccessConfig()) {
  const normalized = normalizeEmail(email)
  const role: AppRole = config.adminEmails.includes(normalized) ? "admin" : "engineer"
  const domain = normalized.split("@")[1] ?? ""
  const allowAll = config.allowedEmails.length === 0 && config.allowedDomains.length === 0
  const isAllowed =
    allowAll ||
    config.adminEmails.includes(normalized) ||
    config.allowedEmails.includes(normalized) ||
    config.allowedDomains.includes(domain)

  return {
    role,
    isAllowed,
    canManageDocuments: canManageDocuments(role) && isAllowed
  }
}
```

```ts
// convex/lib/viewer.ts
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server"

import { ConvexError } from "convex/values"

import { getAuthUserId } from "@convex-dev/auth/server"

import { computeViewerAccess } from "./roles"

type ViewerCtx = QueryCtx | MutationCtx | ActionCtx

export async function getViewer(ctx: ViewerCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    return null
  }
  const user = await ctx.db.get(userId)
  if (!user?.email) {
    return null
  }
  const access = computeViewerAccess(user.email)
  return {
    userId,
    email: user.email,
    name: user.name ?? user.email,
    role: access.role,
    isAllowed: access.isAllowed,
    canManageDocuments: access.canManageDocuments
  }
}

export async function requireAllowedViewer(ctx: ViewerCtx) {
  const viewer = await getViewer(ctx)
  if (!viewer) {
    throw new ConvexError("Authentication required")
  }
  if (!viewer.isAllowed) {
    throw new ConvexError("Your account is not allowed to use this workspace")
  }
  return viewer
}

export async function requireAdminViewer(ctx: ViewerCtx) {
  const viewer = await requireAllowedViewer(ctx)
  if (!viewer.canManageDocuments) {
    throw new ConvexError("Admin access required")
  }
  return viewer
}
```

```ts
// convex/users.ts
import { v } from "convex/values"

import { query } from "./_generated/server"
import { getViewer } from "./lib/viewer"

export const current = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      email: v.string(),
      name: v.string(),
      role: v.union(v.literal("admin"), v.literal("engineer")),
      isAllowed: v.boolean(),
      canManageDocuments: v.boolean()
    })
  ),
  handler: async (ctx) => {
    const viewer = await getViewer(ctx)
    if (!viewer) {
      return null
    }
    return viewer
  }
})
```

```ts
// convex/schema.ts
import { defineSchema } from "convex/server"

import { authTables } from "@convex-dev/auth/server"

export default defineSchema({
  ...authTables
})
```

```tsx
// src/app/providers/ConvexProvider.tsx
import type { ReactNode } from "react"

import { ConvexReactClient } from "convex/react"

import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { CONVEX_SITE_URL, CONVEX_URL } from "astro:env/client"

import { getPublicAppEnv } from "@shared/config/env"

const { convexUrl } = getPublicAppEnv({ CONVEX_URL, CONVEX_SITE_URL })
const client = new ConvexReactClient(convexUrl)

export function ConvexProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthProvider client={client} storageNamespace="automation-manuals">
      {children}
    </ConvexAuthProvider>
  )
}
```

```ts
// src/entities/auth/model/types.ts
export type AppRole = "admin" | "engineer"

export type CurrentViewer = {
  userId: string
  email: string
  name: string
  role: AppRole
  isAllowed: boolean
  canManageDocuments: boolean
}
```

- [ ] **Step 4: Run the focused auth test and repo verification**

Run:

```bash
bunx vitest run convex/lib/roles.test.ts
bun run lint
```

Expected: role tests pass, Convex auth files typecheck, lint exits 0.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/auth.config.ts convex/auth.ts convex/http.ts convex/lib/roles.ts convex/lib/viewer.ts convex/users.ts src/app/providers/ConvexProvider.tsx src/entities/auth/model/types.ts convex/lib/roles.test.ts
git commit -m "feat(auth): wire Convex Auth and viewer access"
```

### Task 3: Domain Schema and Admin CRUD

**Files:**

- Modify: `convex/schema.ts`
- Create: `convex/lib/validators.ts`
- Create: `convex/lib/ingestionState.ts`
- Create: `convex/documents.ts`
- Create: `convex/ingestion.ts`
- Create: `convex/assets.ts`
- Test: `convex/lib/ingestionState.test.ts`

- [ ] **Step 1: Write the failing ingestion-state test**

```ts
// convex/lib/ingestionState.test.ts
import { describe, expect, it } from "vitest"

import { assertNextIngestionStatus } from "./ingestionState"

describe("assertNextIngestionStatus", () => {
  it("allows queued -> downloading", () => {
    expect(() => assertNextIngestionStatus("queued", "downloading")).not.toThrow()
  })

  it("rejects embedding -> parsing", () => {
    expect(() => assertNextIngestionStatus("embedding", "parsing")).toThrow("Invalid ingestion status transition")
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run convex/lib/ingestionState.test.ts`

Expected: FAIL with `Cannot find module './ingestionState'`.

- [ ] **Step 3: Implement validators, schema, and admin CRUD**

```ts
// convex/lib/validators.ts
import { v } from "convex/values"

export const documentStatusValidator = v.union(
  v.literal("draft"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("inactive")
)

export const ingestionStatusValidator = v.union(
  v.literal("queued"),
  v.literal("downloading"),
  v.literal("parsing"),
  v.literal("normalizing"),
  v.literal("embedding"),
  v.literal("ready"),
  v.literal("failed")
)

export const chunkTypeValidator = v.union(
  v.literal("text"),
  v.literal("table"),
  v.literal("diagram_description"),
  v.literal("warning"),
  v.literal("spec")
)

export const messageRoleValidator = v.union(v.literal("user"), v.literal("assistant"))
export const answerabilityStatusValidator = v.union(v.literal("grounded"), v.literal("insufficient_evidence"))
export const severityValidator = v.union(v.literal("informational"), v.literal("operational"), v.literal("safety-critical"))
```

```ts
// convex/lib/ingestionState.ts
export type IngestionStatus = "queued" | "downloading" | "parsing" | "normalizing" | "embedding" | "ready" | "failed"

const ALLOWED_NEXT: Record<IngestionStatus, IngestionStatus[]> = {
  queued: ["downloading", "failed"],
  downloading: ["parsing", "failed"],
  parsing: ["normalizing", "failed"],
  normalizing: ["embedding", "failed"],
  embedding: ["ready", "failed"],
  ready: [],
  failed: ["queued"]
}

export function assertNextIngestionStatus(current: IngestionStatus, next: IngestionStatus) {
  if (!ALLOWED_NEXT[current].includes(next)) {
    throw new Error(`Invalid ingestion status transition: ${current} -> ${next}`)
  }
}
```

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import { authTables } from "@convex-dev/auth/server"

import {
  answerabilityStatusValidator,
  chunkTypeValidator,
  documentStatusValidator,
  ingestionStatusValidator,
  messageRoleValidator,
  severityValidator
} from "./lib/validators"

export default defineSchema({
  ...authTables,
  vendors: defineTable({
    slug: v.string(),
    name: v.string(),
    createdAt: v.number()
  }).index("by_slug", ["slug"]),
  products: defineTable({
    vendorId: v.id("vendors"),
    slug: v.string(),
    name: v.string(),
    createdAt: v.number()
  }).index("by_vendor_and_slug", ["vendorId", "slug"]),
  documents: defineTable({
    vendorId: v.id("vendors"),
    productId: v.id("products"),
    vendorSlug: v.string(),
    productSlug: v.string(),
    title: v.string(),
    version: v.string(),
    language: v.string(),
    sourceUrl: v.string(),
    sourceAssetId: v.optional(v.id("documentAssets")),
    status: documentStatusValidator,
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users")
  })
    .index("by_product", ["productId"])
    .index("by_product_and_active", ["productId", "isActive"]),
  ingestionJobs: defineTable({
    documentId: v.id("documents"),
    requestedBy: v.id("users"),
    status: ingestionStatusValidator,
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_document", ["documentId"]),
  documentAssets: defineTable({
    documentId: v.id("documents"),
    ingestionJobId: v.id("ingestionJobs"),
    kind: v.union(v.literal("source_pdf")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    pageNumber: v.optional(v.number()),
    isCurrent: v.boolean(),
    createdAt: v.number()
  }).index("by_document_and_current", ["documentId", "isCurrent"]),
  documentPages: defineTable({
    documentId: v.id("documents"),
    ingestionJobId: v.id("ingestionJobs"),
    pageNumber: v.number(),
    printedPageNumber: v.optional(v.string()),
    markdown: v.string(),
    needsOcrFallback: v.boolean(),
    isCurrent: v.boolean()
  }).index("by_document_and_current", ["documentId", "isCurrent"]),
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
    .index("by_document_and_page", ["documentId", "pageNumber"]),
  chunkEmbeddings: defineTable({
    chunkId: v.id("chunks"),
    documentId: v.id("documents"),
    vendorSlug: v.string(),
    productSlug: v.string(),
    chunkType: chunkTypeValidator,
    isCurrent: v.boolean(),
    embedding: v.array(v.float64())
  })
    .index("by_chunk", ["chunkId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["documentId", "vendorSlug", "productSlug", "chunkType", "isCurrent"]
    }),
  chatSessions: defineTable({
    userId: v.id("users"),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_user", ["userId"]),
  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    userId: v.id("users"),
    role: messageRoleValidator,
    content: v.string(),
    answerabilityStatus: v.optional(answerabilityStatusValidator),
    createdAt: v.number()
  }).index("by_session", ["sessionId"]),
  answerEvidence: defineTable({
    messageId: v.id("chatMessages"),
    chunkId: v.id("chunks"),
    assetId: v.optional(v.id("documentAssets")),
    pageNumber: v.number(),
    score: v.number()
  }).index("by_message", ["messageId"]),
  evaluationCases: defineTable({
    slug: v.string(),
    question: v.string(),
    category: v.string(),
    severity: severityValidator,
    expectedDocumentTitle: v.string(),
    expectedPageNumbers: v.array(v.number()),
    expectedRefusal: v.boolean()
  }).index("by_slug", ["slug"]),
  auditEvents: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    summary: v.string(),
    createdAt: v.number()
  }).index("by_actor", ["actorUserId"])
})
```

```ts
// convex/documents.ts
import type { MutationCtx } from "./_generated/server"

import { v } from "convex/values"

import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { documentStatusValidator } from "./lib/validators"
import { requireAdminViewer } from "./lib/viewer"

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

async function upsertVendor(ctx: MutationCtx, name: string) {
  const slug = toSlug(name)
  const existing = await ctx.db
    .query("vendors")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique()
  if (existing) return existing._id
  return await ctx.db.insert("vendors", { slug, name: name.trim(), createdAt: Date.now() })
}

async function upsertProduct(ctx: MutationCtx, vendorId: string, name: string) {
  const slug = toSlug(name)
  const existing = await ctx.db
    .query("products")
    .withIndex("by_vendor_and_slug", (q) => q.eq("vendorId", vendorId).eq("slug", slug))
    .unique()
  if (existing) return existing._id
  return await ctx.db.insert("products", { vendorId, slug, name: name.trim(), createdAt: Date.now() })
}

export const listAdmin = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      title: v.string(),
      version: v.string(),
      vendorSlug: v.string(),
      productSlug: v.string(),
      status: documentStatusValidator,
      isActive: v.boolean()
    })
  ),
  handler: async (ctx) => {
    await requireAdminViewer(ctx)
    return await ctx.db.query("documents").collect()
  }
})

export const create = mutation({
  args: {
    vendorName: v.string(),
    productName: v.string(),
    title: v.string(),
    version: v.string(),
    language: v.string(),
    sourceUrl: v.string()
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const vendorId = await upsertVendor(ctx, args.vendorName)
    const productId = await upsertProduct(ctx, vendorId, args.productName)
    const now = Date.now()
    const documentId = await ctx.db.insert("documents", {
      vendorId,
      productId,
      vendorSlug: toSlug(args.vendorName),
      productSlug: toSlug(args.productName),
      title: args.title.trim(),
      version: args.version.trim(),
      language: args.language.trim(),
      sourceUrl: args.sourceUrl.trim(),
      status: "draft",
      isActive: false,
      createdAt: now,
      updatedAt: now,
      createdBy: viewer.userId
    })
    await ctx.db.insert("auditEvents", {
      actorUserId: viewer.userId,
      action: "document.create",
      targetTable: "documents",
      targetId: documentId,
      summary: `Created ${args.title.trim()} ${args.version.trim()}`,
      createdAt: now
    })
    return documentId
  }
})
```

```ts
// convex/ingestion.ts
import { v } from "convex/values"

import { internalMutation, mutation, query } from "./_generated/server"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { ingestionStatusValidator } from "./lib/validators"
import { requireAdminViewer } from "./lib/viewer"

export const listJobs = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("ingestionJobs"),
      documentId: v.id("documents"),
      status: ingestionStatusValidator,
      errorMessage: v.optional(v.string())
    })
  ),
  handler: async (ctx) => {
    await requireAdminViewer(ctx)
    return await ctx.db.query("ingestionJobs").collect()
  }
})

export const enqueue = mutation({
  args: { documentId: v.id("documents") },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const now = Date.now()
    const jobId = await ctx.db.insert("ingestionJobs", {
      documentId: args.documentId,
      requestedBy: viewer.userId,
      status: "queued",
      createdAt: now,
      updatedAt: now
    })
    return jobId
  }
})

export const retry = mutation({
  args: { jobId: v.id("ingestionJobs") },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const existing = await ctx.db.get(args.jobId)
    if (!existing) {
      throw new Error("Ingestion job not found")
    }
    const now = Date.now()
    const retryJobId = await ctx.db.insert("ingestionJobs", {
      documentId: existing.documentId,
      requestedBy: viewer.userId,
      status: "queued",
      createdAt: now,
      updatedAt: now
    })
    await ctx.scheduler.runAfter(0, internal.ingestion.runDocumentJob, {
      documentId: existing.documentId,
      jobId: retryJobId
    })
    return retryJobId
  }
})

export const updateJobStatus = internalMutation({
  args: { jobId: v.id("ingestionJobs"), status: ingestionStatusValidator, errorMessage: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) return null
    assertNextIngestionStatus(job.status, args.status)
    await ctx.db.patch(args.jobId, {
      status: args.status,
      errorMessage: args.errorMessage,
      updatedAt: Date.now()
    })
    return null
  }
})
```

```ts
// convex/assets.ts
import { v } from "convex/values"

import { query } from "./_generated/server"

export const resolveViewerAsset = query({
  args: { assetId: v.id("documentAssets") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documentAssets"),
      kind: v.literal("source_pdf"),
      url: v.string(),
      pageNumber: v.optional(v.number())
    })
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (!asset) return null
    const url = await ctx.storage.getUrl(asset.storageId)
    if (!url) return null
    return { _id: asset._id, kind: "source_pdf", url, pageNumber: asset.pageNumber }
  }
})
```

- [ ] **Step 4: Run the state test and repo verification**

Run:

```bash
bunx vitest run convex/lib/ingestionState.test.ts
bun run lint
```

Expected: ingestion-state test passes and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/lib/validators.ts convex/lib/ingestionState.ts convex/lib/ingestionState.test.ts convex/documents.ts convex/ingestion.ts convex/assets.ts
git commit -m "feat(documents): add SP1 domain schema"
```

### Task 4: Provider Adapters and Markdown Normalization

**Files:**

- Create: `convex/lib/env.ts`
- Create: `convex/lib/llamaCloud.ts`
- Create: `convex/lib/mistral.ts`
- Create: `convex/lib/normalize.ts`
- Test: `convex/lib/normalize.test.ts`

- [ ] **Step 1: Write the failing normalization test**

```ts
// convex/lib/normalize.test.ts
import { describe, expect, it } from "vitest"

import { normalizeParsedPages } from "./normalize"

describe("normalizeParsedPages", () => {
  it("keeps markdown tables as table chunks", () => {
    const result = normalizeParsedPages([
      {
        pageNumber: 45,
        printedPageNumber: "45",
        markdown: "## LED status\n\n| LED | Meaning |\n| --- | --- |\n| OK red | Hardware fault |"
      }
    ])

    expect(result.chunks.map((chunk) => chunk.chunkType)).toEqual(["text", "table"])
  })

  it("flags image-placeholder pages for OCR fallback", () => {
    const result = normalizeParsedPages([
      {
        pageNumber: 9,
        printedPageNumber: "9",
        markdown: "![img-0.jpeg](img-0.jpeg)"
      }
    ])

    expect(result.pages[0]?.needsOcrFallback).toBe(true)
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run convex/lib/normalize.test.ts`

Expected: FAIL with `Cannot find module './normalize'`.

- [ ] **Step 3: Implement env, provider, and normalization helpers**

```ts
// convex/lib/env.ts
function requireEnv(name: string) {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(`${name} must be configured`)
  }
  return value.trim()
}

export function getServerEnv() {
  return {
    llamaCloudApiKey: requireEnv("LLAMA_CLOUD_API_KEY"),
    mistralApiKey: requireEnv("MISTRAL_API_KEY"),
    mistralChatModel: process.env.MISTRAL_CHAT_MODEL?.trim() || "mistral-small-latest",
    mistralEmbedModel: process.env.MISTRAL_EMBED_MODEL?.trim() || "mistral-embed"
  }
}
```

```ts
// convex/lib/llamaCloud.ts
import LlamaCloud from "@llamaindex/llama-cloud"

import { getServerEnv } from "./env"

export type ParsedPage = {
  pageNumber: number
  printedPageNumber?: string
  markdown: string
}

export async function parseDocumentMarkdown(sourceUrl: string): Promise<ParsedPage[]> {
  const client = new LlamaCloud({ apiKey: getServerEnv().llamaCloudApiKey })
  const result = await client.parsing.parse({
    source_url: sourceUrl,
    tier: "agentic",
    version: "latest",
    output_options: {
      extract_printed_page_number: true,
      markdown: {
        output_tables_as_markdown: true,
        merge_continued_tables: true
      }
    },
    expand: ["markdown"]
  })

  return (result.markdown?.pages ?? []).map((page) => ({
    pageNumber: page.page_number,
    printedPageNumber: page.printed_page_number ?? undefined,
    markdown: page.md
  }))
}
```

```ts
// convex/lib/mistral.ts
import { Mistral } from "@mistralai/mistralai"

import { getServerEnv } from "./env"

function getClient() {
  return new Mistral({ apiKey: getServerEnv().mistralApiKey })
}

export async function embedTexts(inputs: string[]) {
  const client = getClient()
  const result = await client.embeddings.create({
    model: getServerEnv().mistralEmbedModel,
    inputs
  })
  return result.data.map((item) => item.embedding)
}

export async function ocrPdfPage(sourceUrl: string, pageNumber: number) {
  const client = getClient()
  const result = await client.ocr.process({
    model: "mistral-ocr-latest",
    document: {
      type: "document_url",
      documentUrl: sourceUrl
    },
    pages: [pageNumber - 1],
    tableFormat: "markdown"
  })
  return result.pages[0]?.markdown ?? ""
}

export async function generateGroundedAnswer(question: string, context: string) {
  const client = getClient()
  const response = await client.chat.complete({
    model: getServerEnv().mistralChatModel,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Return strict JSON with keys answerSummary and answerSteps. Use only the provided context. If context is insufficient, say so in answerSummary and return an empty answerSteps array."
      },
      {
        role: "user",
        content: `Question: ${question}\n\nContext:\n${context}`
      }
    ]
  })

  const content = response.choices[0]?.message?.content
  const jsonText = typeof content === "string" ? content : "{}"
  return JSON.parse(jsonText) as { answerSummary: string; answerSteps: string[] }
}
```

```ts
// convex/lib/normalize.ts
import type { ParsedPage } from "./llamaCloud"

function splitBlocks(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function classifyBlock(block: string) {
  if (/^\|.+\|$/m.test(block)) return "table" as const
  if (/warning|danger|caution/i.test(block)) return "warning" as const
  if (/wiring|slot|backplane|chassis|diagram/i.test(block)) return "diagram_description" as const
  if (/catalog|module|specification|terminal|connector/i.test(block)) return "spec" as const
  return "text" as const
}

function shouldUseOcrFallback(markdown: string) {
  const trimmed = markdown.trim()
  return trimmed.startsWith("![") || trimmed.length < 80
}

export function normalizeParsedPages(pages: ParsedPage[]) {
  const normalizedPages = pages.map((page) => ({
    pageNumber: page.pageNumber,
    printedPageNumber: page.printedPageNumber,
    markdown: page.markdown,
    needsOcrFallback: shouldUseOcrFallback(page.markdown)
  }))

  const chunks = pages.flatMap((page) =>
    splitBlocks(page.markdown).map((block) => ({
      pageNumber: page.pageNumber,
      chunkType: classifyBlock(block),
      content: block,
      citationLabel: `Page ${page.pageNumber}`
    }))
  )

  return { pages: normalizedPages, chunks }
}
```

- [ ] **Step 4: Run the normalization test and repo verification**

Run:

```bash
bunx vitest run convex/lib/normalize.test.ts
bun run lint
```

Expected: normalization test passes and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/env.ts convex/lib/llamaCloud.ts convex/lib/mistral.ts convex/lib/normalize.ts convex/lib/normalize.test.ts
git commit -m "feat(ingestion): add provider adapters and normalization"
```

### Task 5: Ingestion Execution and File Storage

**Files:**

- Modify: `convex/ingestion.ts`
- Modify: `convex/documents.ts`
- Create: `convex/lib/ingestDocument.ts`
- Test: `convex/lib/ingestDocument.test.ts`

- [ ] **Step 1: Write the failing ingestion-payload test**

```ts
// convex/lib/ingestDocument.test.ts
import { describe, expect, it, vi } from "vitest"

import { buildDocumentPayload } from "./ingestDocument"

describe("buildDocumentPayload", () => {
  it("reruns OCR only for flagged pages and aligns embeddings with chunks", async () => {
    const parse = vi.fn().mockResolvedValue([
      { pageNumber: 1, printedPageNumber: "1", markdown: "Normal paragraph about controller wiring." },
      { pageNumber: 2, printedPageNumber: "2", markdown: "![img-0.jpeg](img-0.jpeg)" }
    ])
    const ocr = vi.fn().mockResolvedValue("Partner module must be installed to the right of the primary controller.")
    const embed = vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4]
    ])

    const payload = await buildDocumentPayload({ parse, ocr, embed, sourceUrl: "https://vendor/manual.pdf" })

    expect(ocr).toHaveBeenCalledTimes(1)
    expect(payload.chunks).toHaveLength(2)
    expect(payload.embeddings).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run convex/lib/ingestDocument.test.ts`

Expected: FAIL with `Cannot find module './ingestDocument'`.

- [ ] **Step 3: Implement the orchestrator and wire job scheduling**

```ts
// convex/lib/ingestDocument.ts
import { normalizeParsedPages } from "./normalize"

type BuildDocumentPayloadArgs = {
  sourceUrl: string
  parse: () => Promise<Array<{ pageNumber: number; printedPageNumber?: string; markdown: string }>>
  ocr: (sourceUrl: string, pageNumber: number) => Promise<string>
  embed: (inputs: string[]) => Promise<number[][]>
}

export async function buildDocumentPayload(args: BuildDocumentPayloadArgs) {
  const initialPages = await args.parse()
  const firstPass = normalizeParsedPages(initialPages)

  const repairedPages = await Promise.all(
    firstPass.pages.map(async (page) => {
      if (!page.needsOcrFallback) return page
      const markdown = await args.ocr(args.sourceUrl, page.pageNumber)
      return {
        pageNumber: page.pageNumber,
        printedPageNumber: page.printedPageNumber,
        markdown
      }
    })
  )

  const finalPass = normalizeParsedPages(repairedPages)
  const embeddings = finalPass.chunks.length === 0 ? [] : await args.embed(finalPass.chunks.map((chunk) => chunk.content))

  return {
    pages: finalPass.pages,
    chunks: finalPass.chunks,
    embeddings
  }
}
```

```ts
// convex/ingestion.ts (replace enqueue and add action excerpt)
"use node"

import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction, internalMutation, mutation, query } from "./_generated/server"
import { buildDocumentPayload } from "./lib/ingestDocument"
import { assertNextIngestionStatus } from "./lib/ingestionState"
import { parseDocumentMarkdown } from "./lib/llamaCloud"
import { embedTexts, ocrPdfPage } from "./lib/mistral"
import { requireAdminViewer } from "./lib/viewer"

export const enqueue = mutation({
  args: { documentId: v.id("documents") },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const viewer = await requireAdminViewer(ctx)
    const now = Date.now()
    const jobId = await ctx.db.insert("ingestionJobs", {
      documentId: args.documentId,
      requestedBy: viewer.userId,
      status: "queued",
      createdAt: now,
      updatedAt: now
    })
    await ctx.scheduler.runAfter(0, internal.ingestion.runDocumentJob, { documentId: args.documentId, jobId })
    return jobId
  }
})

export const runDocumentJob = internalAction({
  args: { documentId: v.id("documents"), jobId: v.id("ingestionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.runQuery(internal.documents.getById, { documentId: args.documentId })
    if (!document) return null

    try {
      await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId: args.jobId, status: "downloading" })

      const pdfResponse = await fetch(document.sourceUrl)
      const pdfBlob = new Blob([await pdfResponse.arrayBuffer()], {
        type: pdfResponse.headers.get("content-type") ?? "application/pdf"
      })
      const storageId = await ctx.storage.store(pdfBlob)

      await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId: args.jobId, status: "parsing" })

      const payload = await buildDocumentPayload({
        sourceUrl: document.sourceUrl,
        parse: () => parseDocumentMarkdown(document.sourceUrl),
        ocr: ocrPdfPage,
        embed: embedTexts
      })

      await ctx.runMutation(internal.documents.replaceParsedContent, {
        documentId: args.documentId,
        jobId: args.jobId,
        storageId,
        fileName: `${document.productSlug}-${document.version}.pdf`,
        pages: payload.pages,
        chunks: payload.chunks,
        embeddings: payload.embeddings
      })

      await ctx.runMutation(internal.documents.markReady, { documentId: args.documentId })
      await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId: args.jobId, status: "ready" })
      return null
    } catch (error) {
      await ctx.runMutation(internal.documents.markFailed, {
        documentId: args.documentId,
        errorMessage: error instanceof Error ? error.message : "Unknown ingestion error"
      })
      await ctx.runMutation(internal.ingestion.updateJobStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown ingestion error"
      })
      return null
    }
  }
})
```

```ts
// convex/documents.ts (internal mutation excerpt)
export const getById = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      sourceUrl: v.string(),
      vendorSlug: v.string(),
      productSlug: v.string(),
      title: v.string(),
      version: v.string()
    })
  ),
  handler: async (ctx, args) => await ctx.db.get(args.documentId)
})

export const markReady = internalMutation({
  args: { documentId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, { status: "ready", updatedAt: Date.now() })
    return null
  }
})

export const markFailed = internalMutation({
  args: { documentId: v.id("documents"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, { status: "failed", updatedAt: Date.now() })
    return null
  }
})
```

- [ ] **Step 4: Run the ingestion payload test and repo verification**

Run:

```bash
bunx vitest run convex/lib/ingestDocument.test.ts
bun run lint
```

Expected: ingestion payload test passes and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add convex/ingestion.ts convex/documents.ts convex/lib/ingestDocument.ts convex/lib/ingestDocument.test.ts
git commit -m "feat(ingestion): run document pipeline"
```

### Task 6: Search, Chat, and Structured Answer Packets

**Files:**

- Create: `convex/lib/answerPacket.ts`
- Create: `convex/chats.ts`
- Create: `convex/search.ts`
- Test: `convex/lib/answerPacket.test.ts`

- [ ] **Step 1: Write the failing answer-packet test**

```ts
// convex/lib/answerPacket.test.ts
import { describe, expect, it } from "vitest"

import { buildGroundedPacket, buildRefusalPacket } from "./answerPacket"

describe("buildRefusalPacket", () => {
  it("returns an empty evidence set for insufficient context", () => {
    expect(buildRefusalPacket("Where should the partner module go?")).toEqual({
      answerabilityStatus: "insufficient_evidence",
      answerSummary: "I could not find enough evidence in the official documentation to answer that safely.",
      answerSteps: [],
      citations: [],
      supportingAssets: []
    })
  })
})

describe("buildGroundedPacket", () => {
  it("deduplicates citations by page and asset", () => {
    const packet = buildGroundedPacket({
      answerSummary: "Install the partner immediately to the right of the primary controller.",
      answerSteps: ["Verify the partner module is adjacent to the primary controller."],
      evidence: [
        { chunkId: "chunk-1", pageNumber: 9, score: 0.91, citationLabel: "Page 9", assetId: "asset-1" },
        { chunkId: "chunk-2", pageNumber: 9, score: 0.88, citationLabel: "Page 9", assetId: "asset-1" }
      ]
    })

    expect(packet.citations).toHaveLength(1)
    expect(packet.supportingAssets).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run convex/lib/answerPacket.test.ts`

Expected: FAIL with `Cannot find module './answerPacket'`.

- [ ] **Step 3: Implement answer packets and search/chat actions**

```ts
// convex/lib/answerPacket.ts
export function buildRefusalPacket(_question: string) {
  return {
    answerabilityStatus: "insufficient_evidence" as const,
    answerSummary: "I could not find enough evidence in the official documentation to answer that safely.",
    answerSteps: [] as string[],
    citations: [] as Array<{ chunkId: string; pageNumber: number; citationLabel: string; assetId?: string }>,
    supportingAssets: [] as Array<{ assetId: string; pageNumber: number; label: string }>
  }
}

export function buildGroundedPacket(args: {
  answerSummary: string
  answerSteps: string[]
  evidence: Array<{ chunkId: string; pageNumber: number; score: number; citationLabel: string; assetId?: string }>
}) {
  const seen = new Set<string>()
  const citations = []
  const supportingAssets = []

  for (const item of args.evidence) {
    const key = `${item.pageNumber}:${item.assetId ?? "none"}`
    if (seen.has(key)) continue
    seen.add(key)
    citations.push({
      chunkId: item.chunkId,
      pageNumber: item.pageNumber,
      citationLabel: item.citationLabel,
      assetId: item.assetId
    })
    if (item.assetId) {
      supportingAssets.push({ assetId: item.assetId, pageNumber: item.pageNumber, label: item.citationLabel })
    }
  }

  return {
    answerabilityStatus: "grounded" as const,
    answerSummary: args.answerSummary,
    answerSteps: args.answerSteps,
    citations,
    supportingAssets
  }
}
```

```ts
// convex/chats.ts
import { v } from "convex/values"

import { internalMutation, query } from "./_generated/server"
import { answerabilityStatusValidator, messageRoleValidator } from "./lib/validators"
import { requireAllowedViewer } from "./lib/viewer"

export const listMessages = query({
  args: { sessionId: v.id("chatSessions") },
  returns: v.array(v.object({ _id: v.id("chatMessages"), role: messageRoleValidator, content: v.string() })),
  handler: async (ctx, args) => {
    const viewer = await requireAllowedViewer(ctx)
    const session = await ctx.db.get(args.sessionId)
    if (!session || session.userId !== viewer.userId) return []
    return await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()
  }
})

export const ensureSession = internalMutation({
  args: { userId: v.id("users"), title: v.string() },
  returns: v.id("chatSessions"),
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert("chatSessions", { userId: args.userId, title: args.title, createdAt: now, updatedAt: now })
  }
})

export const appendMessage = internalMutation({
  args: {
    sessionId: v.id("chatSessions"),
    userId: v.id("users"),
    role: messageRoleValidator,
    content: v.string(),
    answerabilityStatus: v.optional(answerabilityStatusValidator)
  },
  returns: v.id("chatMessages"),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { updatedAt: Date.now() })
    return await ctx.db.insert("chatMessages", { ...args, createdAt: Date.now() })
  }
})
```

```ts
// convex/search.ts
"use node"

import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import { action, internalMutation, internalQuery } from "./_generated/server"
import { buildGroundedPacket, buildRefusalPacket } from "./lib/answerPacket"
import { embedTexts, generateGroundedAnswer } from "./lib/mistral"
import { answerabilityStatusValidator } from "./lib/validators"
import { requireAllowedViewer } from "./lib/viewer"

const PACKET_VALIDATOR = v.object({
  sessionId: v.id("chatSessions"),
  answerabilityStatus: answerabilityStatusValidator,
  answerSummary: v.string(),
  answerSteps: v.array(v.string()),
  citations: v.array(
    v.object({
      chunkId: v.id("chunks"),
      pageNumber: v.number(),
      citationLabel: v.string(),
      assetId: v.optional(v.id("documentAssets"))
    })
  ),
  supportingAssets: v.array(v.object({ assetId: v.id("documentAssets"), pageNumber: v.number(), label: v.string() }))
})

export const hydrateResults = internalQuery({
  args: { embeddingIds: v.array(v.id("chunkEmbeddings")) },
  returns: v.array(
    v.object({
      chunkId: v.id("chunks"),
      content: v.string(),
      pageNumber: v.number(),
      citationLabel: v.string(),
      assetId: v.optional(v.id("documentAssets"))
    })
  ),
  handler: async (ctx, args) => {
    const rows = []
    for (const embeddingId of args.embeddingIds) {
      const embedding = await ctx.db.get(embeddingId)
      if (!embedding) continue
      if (!embedding.isCurrent) continue
      const chunk = await ctx.db.get(embedding.chunkId)
      if (!chunk) continue
      if (!chunk.isCurrent) continue
      const asset = await ctx.db
        .query("documentAssets")
        .withIndex("by_document_and_current", (q) => q.eq("documentId", chunk.documentId).eq("isCurrent", true))
        .first()
      rows.push({
        chunkId: chunk._id,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        citationLabel: chunk.citationLabel,
        assetId: asset?._id
      })
    }
    return rows
  }
})

export const ask = action({
  args: {
    question: v.string(),
    sessionId: v.optional(v.id("chatSessions")),
    documentId: v.optional(v.id("documents"))
  },
  returns: PACKET_VALIDATOR,
  handler: async (ctx, args) => {
    const viewer = await requireAllowedViewer(ctx)
    const [questionEmbedding] = await embedTexts([args.question])
    const vectorSearchArgs = args.documentId
      ? {
          vector: questionEmbedding,
          limit: 6,
          filter: (q: { eq: (field: string, value: unknown) => unknown }) => q.eq("documentId", args.documentId)
        }
      : { vector: questionEmbedding, limit: 6 }
    const hits = await ctx.vectorSearch("chunkEmbeddings", "by_embedding", vectorSearchArgs)
    const evidence = await ctx.runQuery(internal.search.hydrateResults, { embeddingIds: hits.map((hit) => hit._id) })

    const sessionId =
      args.sessionId ??
      (await ctx.runMutation(internal.chats.ensureSession, { userId: viewer.userId, title: args.question.slice(0, 80) }))
    await ctx.runMutation(internal.chats.appendMessage, {
      sessionId,
      userId: viewer.userId,
      role: "user",
      content: args.question
    })

    if (evidence.length === 0 || (hits[0]?._score ?? 0) < 0.55) {
      const refusal = buildRefusalPacket(args.question)
      await ctx.runMutation(internal.chats.appendMessage, {
        sessionId,
        userId: viewer.userId,
        role: "assistant",
        content: refusal.answerSummary,
        answerabilityStatus: refusal.answerabilityStatus
      })
      return { sessionId, ...refusal }
    }

    const grounded = await generateGroundedAnswer(
      args.question,
      evidence.map((item) => `[${item.citationLabel}] ${item.content}`).join("\n\n")
    )
    const scoredEvidence = evidence.map((item, index) => ({ ...item, score: hits[index]?._score ?? 0 }))
    const packet = buildGroundedPacket({
      answerSummary: grounded.answerSummary,
      answerSteps: grounded.answerSteps,
      evidence: scoredEvidence
    })

    const messageId = await ctx.runMutation(internal.chats.appendMessage, {
      sessionId,
      userId: viewer.userId,
      role: "assistant",
      content: packet.answerSummary,
      answerabilityStatus: packet.answerabilityStatus
    })

    for (const citation of packet.citations) {
      const evidenceRow = scoredEvidence.find((item) => item.chunkId === citation.chunkId)
      await ctx.runMutation(internal.search.recordEvidence, {
        messageId,
        chunkId: citation.chunkId,
        assetId: citation.assetId,
        pageNumber: citation.pageNumber,
        score: evidenceRow?.score ?? 0
      })
    }

    return { sessionId, ...packet }
  }
})

export const recordEvidence = internalMutation({
  args: {
    messageId: v.id("chatMessages"),
    chunkId: v.id("chunks"),
    assetId: v.optional(v.id("documentAssets")),
    pageNumber: v.number(),
    score: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("answerEvidence", args)
    return null
  }
})
```

- [ ] **Step 4: Run the answer-packet test and repo verification**

Run:

```bash
bunx vitest run convex/lib/answerPacket.test.ts
bun run lint
```

Expected: answer packet tests pass and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/answerPacket.ts convex/lib/answerPacket.test.ts convex/chats.ts convex/search.ts
git commit -m "feat(search): add grounded answer pipeline"
```

### Task 7: Auth Pages and Protected Shells

**Files:**

- Modify: `src/layouts/Layout.astro`
- Modify: `src/pages/index.astro`
- Create: `src/pages/auth.astro`
- Create: `src/pages/app/index.astro`
- Create: `src/pages/admin/index.astro`
- Create: `src/features/auth/ui/AuthScreen.tsx`
- Create: `src/features/auth/ui/AuthGate.tsx`
- Create: `src/features/auth/ui/RoleGate.tsx`
- Create: `src/features/auth/ui/SignOutButton.tsx`
- Create: `src/features/auth/ui/index.ts`
- Create: `src/features/auth/island.tsx`
- Create: `src/widgets/app-shell/ui/AppShell.tsx`
- Create: `src/widgets/app-shell/index.ts`
- Test: `src/features/auth/ui/AuthScreen.test.tsx`

- [ ] **Step 1: Write the failing auth-screen test**

```tsx
// src/features/auth/ui/AuthScreen.test.tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { vi } from "vitest"

import AuthScreen from "./AuthScreen"

const signIn = vi.fn()

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn, signOut: vi.fn() })
}))

describe("AuthScreen", () => {
  it("submits password sign-in by default", () => {
    render(<AuthScreen />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "tech@example.com" } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "Secret123" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))
    expect(signIn).toHaveBeenCalledWith(
      "password",
      expect.objectContaining({ email: "tech@example.com", password: "Secret123", flow: "signIn" })
    )
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run src/features/auth/ui/AuthScreen.test.tsx`

Expected: FAIL with `Cannot find module './AuthScreen'`.

- [ ] **Step 3: Implement the shell and auth UI**

```astro
---
// src/layouts/Layout.astro
import "@app/styles/global.css"

interface Props {
  title?: string
}

const { title = "Automation Manuals" } = Astro.props
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
  </head>
  <body class="min-h-screen bg-slate-950 text-slate-100">
    <slot />
  </body>
</html>
```

```astro
---
// src/pages/index.astro
import Layout from "@/layouts/Layout.astro"
---

<Layout title="Automation Manuals">
  <main class="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-6 px-6 py-16">
    <p class="text-sm tracking-[0.3em] text-cyan-300 uppercase">Automation Manuals</p>
    <h1 class="max-w-3xl text-5xl font-semibold text-white">Grounded technical answers from official vendor manuals.</h1>
    <p class="max-w-2xl text-lg text-slate-300">
      Use one controlled workspace for document ingestion, evidence-bounded retrieval, and split-screen verification.
    </p>
    <a class="inline-flex w-fit rounded-md bg-cyan-400 px-5 py-3 font-medium text-slate-950" href="/auth">Open workspace</a>
  </main>
</Layout>
```

```tsx
// src/features/auth/ui/AuthScreen.tsx
import { useState } from "react"

import { useAuthActions } from "@convex-dev/auth/react"

export default function AuthScreen() {
  const { signIn } = useAuthActions()
  const [mode, setMode] = useState<"signIn" | "signUp" | "magicLink" | "resetRequest" | "resetConfirm">("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const resetCode = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("code") ?? "")

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-16">
      <div className="w-full space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("signIn")}>
            Password
          </button>
          <button type="button" onClick={() => setMode("magicLink")}>
            Magic link
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (mode === "magicLink") {
              void signIn("resend-magic-link", { email, redirectTo: "/auth" })
              return
            }
            if (mode === "resetRequest") {
              void signIn("password", { email, flow: "reset" }).then(() => setMode("resetConfirm"))
              return
            }
            if (mode === "resetConfirm") {
              void signIn("password", { email, code: resetCode, newPassword: password, flow: "reset-verification" })
              return
            }
            void signIn("password", { email, password, flow: mode })
          }}
        >
          <label className="block text-sm">
            Email
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {mode !== "magicLink" && mode !== "resetRequest" && (
            <label className="block text-sm">
              {mode === "resetConfirm" ? "New password" : "Password"}
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}

          <button className="rounded-md bg-cyan-400 px-4 py-2 font-medium text-slate-950" type="submit">
            {mode === "magicLink"
              ? "Send magic link"
              : mode === "signUp"
                ? "Sign up"
                : mode === "resetRequest"
                  ? "Send reset link"
                  : mode === "resetConfirm"
                    ? "Save new password"
                    : "Sign in"}
          </button>
        </form>

        {mode !== "magicLink" && mode !== "resetConfirm" && (
          <button type="button" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
            Use {mode === "signIn" ? "sign up" : "sign in"} instead
          </button>
        )}
        {mode === "signIn" && (
          <button type="button" onClick={() => setMode("resetRequest")}>
            Forgot password?
          </button>
        )}
      </div>
    </section>
  )
}
```

```tsx
// src/features/auth/ui/AuthGate.tsx
import type { ReactNode } from "react"

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AuthScreen from "./AuthScreen"

export function AuthGate({ children }: { children: ReactNode }) {
  const viewer = useQuery(api.users.current, {})

  return (
    <>
      <AuthLoading>
        <div className="p-6 text-sm text-slate-400">Checking session...</div>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        {viewer === undefined ? (
          <div className="p-6 text-sm text-slate-400">Loading workspace...</div>
        ) : viewer && viewer.isAllowed ? (
          children
        ) : (
          <div className="p-6 text-sm text-amber-300">This account is signed in but not allowed to use the workspace.</div>
        )}
      </Authenticated>
    </>
  )
}
```

```tsx
// src/features/auth/ui/RoleGate.tsx
import type { ReactNode } from "react"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

export function RoleGate({ role, children }: { role: "admin" | "engineer"; children: ReactNode }) {
  const viewer = useQuery(api.users.current, {})
  if (viewer === undefined) return <div className="p-6 text-sm text-slate-400">Loading permissions...</div>
  if (!viewer || viewer.role !== role)
    return <div className="p-6 text-sm text-rose-300">You do not have access to this page.</div>
  return <>{children}</>
}
```

```tsx
// src/features/auth/ui/SignOutButton.tsx
import { useAuthActions } from "@convex-dev/auth/react"

export function SignOutButton() {
  const { signOut } = useAuthActions()
  return (
    <button className="rounded-md border border-slate-700 px-3 py-2 text-sm" onClick={() => void signOut()} type="button">
      Sign out
    </button>
  )
}
```

```ts
// src/features/auth/ui/index.ts
export { AuthGate } from "./AuthGate"
export { RoleGate } from "./RoleGate"
export { SignOutButton } from "./SignOutButton"
export { default as AuthScreen } from "./AuthScreen"
```

```tsx
// src/features/auth/island.tsx
import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import AuthScreen from "./ui/AuthScreen"

export default function AuthIsland() {
  return (
    <ConvexProviderWrapper>
      <AuthScreen />
    </ConvexProviderWrapper>
  )
}
```

```tsx
// src/widgets/app-shell/ui/AppShell.tsx
import type { ReactNode } from "react"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import { SignOutButton } from "@features/auth/ui"

export default function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const viewer = useQuery(api.users.current, {})

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-cyan-300 uppercase">Automation Manuals</p>
            <h1 className="text-xl font-semibold text-white">{title}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span>{viewer?.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
    </main>
  )
}
```

```ts
// src/widgets/app-shell/index.ts
export { default } from "./ui/AppShell"
```

```astro
---
// src/pages/auth.astro
import Layout from "@/layouts/Layout.astro"

import AuthIsland from "@features/auth/island"
---

<Layout title="Sign in | Automation Manuals">
  <AuthIsland client:load />
</Layout>
```

```astro
---
// src/pages/app/index.astro
import Layout from "@/layouts/Layout.astro"

import EngineerWorkspaceIsland from "@widgets/engineer-workspace"
---

<Layout title="Engineer Workspace | Automation Manuals">
  <EngineerWorkspaceIsland client:load />
</Layout>
```

```astro
---
// src/pages/admin/index.astro
import Layout from "@/layouts/Layout.astro"

import AdminConsoleIsland from "@widgets/admin-console"
---

<Layout title="Admin Console | Automation Manuals">
  <AdminConsoleIsland client:load />
</Layout>
```

- [ ] **Step 4: Run the auth UI test and repo verification**

Run:

```bash
bunx vitest run src/features/auth/ui/AuthScreen.test.tsx
bun run lint
```

Expected: auth UI test passes and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Layout.astro src/pages/index.astro src/pages/auth.astro src/pages/app/index.astro src/pages/admin/index.astro src/features/auth/ui/AuthScreen.tsx src/features/auth/ui/AuthGate.tsx src/features/auth/ui/RoleGate.tsx src/features/auth/ui/SignOutButton.tsx src/features/auth/ui/index.ts src/features/auth/island.tsx src/widgets/app-shell/ui/AppShell.tsx src/widgets/app-shell/index.ts src/features/auth/ui/AuthScreen.test.tsx
git commit -m "feat(app): add auth routes and protected shell"
```

### Task 8: Admin Console and Engineer Workspace UI

**Files:**

- Create: `src/features/admin-ingestion/ui/DocumentRegistrationForm.tsx`
- Create: `src/features/admin-ingestion/ui/IngestionJobList.tsx`
- Create: `src/features/admin-ingestion/ui/index.ts`
- Create: `src/widgets/admin-console/ui/AdminConsole.tsx`
- Create: `src/widgets/admin-console/island.tsx`
- Create: `src/widgets/admin-console/index.ts`
- Create: `src/entities/chat/model/types.ts`
- Create: `src/entities/knowledge/model/types.ts`
- Create: `src/features/ask-assistant/ui/QuestionComposer.tsx`
- Create: `src/features/ask-assistant/ui/AnswerPacketView.tsx`
- Create: `src/features/ask-assistant/ui/index.ts`
- Create: `src/features/view-evidence/ui/EvidenceViewer.tsx`
- Create: `src/features/view-evidence/ui/index.ts`
- Create: `src/widgets/engineer-workspace/ui/EngineerWorkspace.tsx`
- Create: `src/widgets/engineer-workspace/island.tsx`
- Create: `src/widgets/engineer-workspace/index.ts`
- Test: `src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx`
- Test: `src/features/ask-assistant/ui/AnswerPacketView.test.tsx`

- [ ] **Step 1: Write the failing admin-form and answer-view tests**

```tsx
// src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { vi } from "vitest"

import DocumentRegistrationForm from "./DocumentRegistrationForm"

const onSubmit = vi.fn()

describe("DocumentRegistrationForm", () => {
  it("requires source URL and title before submit", () => {
    render(<DocumentRegistrationForm onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("button", { name: /queue document/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
```

```tsx
// src/features/ask-assistant/ui/AnswerPacketView.test.tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { vi } from "vitest"

import AnswerPacketView from "./AnswerPacketView"

describe("AnswerPacketView", () => {
  it("emits citation selection", () => {
    const onSelect = vi.fn()
    render(
      <AnswerPacketView
        packet={{
          answerabilityStatus: "grounded",
          answerSummary: "Partner goes to the right.",
          answerSteps: ["Check the right-adjacent slot."],
          citations: [{ chunkId: "chunk-1", pageNumber: 9, citationLabel: "Page 9", assetId: "asset-1" }],
          supportingAssets: [{ assetId: "asset-1", pageNumber: 9, label: "Page 9" }]
        }}
        onSelectCitation={onSelect}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /page 9/i }))
    expect(onSelect).toHaveBeenCalledWith({ assetId: "asset-1", pageNumber: 9, label: "Page 9" })
  })
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
bunx vitest run src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx
bunx vitest run src/features/ask-assistant/ui/AnswerPacketView.test.tsx
```

Expected: both tests FAIL because the components do not exist yet.

- [ ] **Step 3: Implement the admin console and engineer workspace**

```tsx
// src/features/admin-ingestion/ui/DocumentRegistrationForm.tsx
import { useState, useTransition } from "react"

type DocumentFormValues = {
  vendorName: string
  productName: string
  title: string
  version: string
  language: string
  sourceUrl: string
}

const initialValues: DocumentFormValues = {
  vendorName: "",
  productName: "",
  title: "",
  version: "",
  language: "English",
  sourceUrl: ""
}

export default function DocumentRegistrationForm({ onSubmit }: { onSubmit: (values: DocumentFormValues) => Promise<void> }) {
  const [values, setValues] = useState(initialValues)
  const [error, setError] = useState<string>()
  const [isPending, startTransition] = useTransition()

  return (
    <form
      className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!values.title.trim() || !values.sourceUrl.trim()) {
          setError("Title and source URL are required.")
          return
        }
        setError(undefined)
        startTransition(() => {
          void onSubmit(values).then(() => setValues(initialValues))
        })
      }}
    >
      {Object.entries(values).map(([key, value]) => (
        <label className="text-sm" key={key}>
          {key}
          <input
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            value={value}
            onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
          />
        </label>
      ))}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <button className="rounded-md bg-cyan-400 px-4 py-2 font-medium text-slate-950" disabled={isPending} type="submit">
        Queue document
      </button>
    </form>
  )
}
```

```tsx
// src/features/admin-ingestion/ui/IngestionJobList.tsx
export default function IngestionJobList({
  jobs,
  onRetry
}: {
  jobs: Array<{ _id: string; status: string; errorMessage?: string }>
  onRetry: (jobId: string) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5">
      {jobs.map((job) => (
        <article className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 px-4 py-3" key={job._id}>
          <div>
            <p className="font-medium text-white">{job.status}</p>
            {job.errorMessage && <p className="text-sm text-rose-300">{job.errorMessage}</p>}
          </div>
          <button className="rounded-md border border-slate-700 px-3 py-2 text-sm" onClick={() => onRetry(job._id)} type="button">
            Retry
          </button>
        </article>
      ))}
    </div>
  )
}
```

```ts
// src/features/admin-ingestion/ui/index.ts
export { default as DocumentRegistrationForm } from "./DocumentRegistrationForm"
export { default as IngestionJobList } from "./IngestionJobList"
```

```tsx
// src/widgets/admin-console/ui/AdminConsole.tsx
import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { DocumentRegistrationForm, IngestionJobList } from "@features/admin-ingestion/ui"
import { AuthGate, RoleGate } from "@features/auth/ui"

export default function AdminConsole() {
  const documents = useQuery(api.documents.listAdmin, {}) ?? []
  const jobs = useQuery(api.ingestion.listJobs, {}) ?? []
  const createDocument = useMutation(api.documents.create)
  const enqueue = useMutation(api.ingestion.enqueue)
  const retryJob = useMutation(api.ingestion.retry)

  return (
    <AuthGate>
      <RoleGate role="admin">
        <AppShell title="Admin Console">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <DocumentRegistrationForm
              onSubmit={async (values) => {
                const documentId = await createDocument(values)
                await enqueue({ documentId })
              }}
            />
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">
                <p className="font-medium text-white">Documents: {documents.length}</p>
              </div>
              <IngestionJobList jobs={jobs} onRetry={(jobId) => void retryJob({ jobId })} />
            </div>
          </div>
        </AppShell>
      </RoleGate>
    </AuthGate>
  )
}
```

```tsx
// src/widgets/admin-console/island.tsx
import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import AdminConsole from "./ui/AdminConsole"

export default function AdminConsoleIsland() {
  return (
    <ConvexProviderWrapper>
      <AdminConsole />
    </ConvexProviderWrapper>
  )
}
```

```ts
// src/widgets/admin-console/index.ts
export { default } from "./island"
```

```ts
// src/entities/chat/model/types.ts
export type AnswerabilityStatus = "grounded" | "insufficient_evidence"
```

```ts
// src/entities/knowledge/model/types.ts
import type { Id } from "@convex/_generated/dataModel"

export type Citation = {
  chunkId: string
  pageNumber: number
  citationLabel: string
  assetId?: Id<"documentAssets">
}

export type SupportingAsset = {
  assetId: Id<"documentAssets">
  pageNumber: number
  label: string
}
```

```tsx
// src/features/ask-assistant/ui/QuestionComposer.tsx
import { useState } from "react"

export default function QuestionComposer({ onSubmit, disabled }: { onSubmit: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState("")
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!value.trim()) return
        onSubmit(value.trim())
        setValue("")
      }}
    >
      <textarea
        className="min-h-32 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"
        placeholder="Describe the hardware issue or ask about a connection rule..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="rounded-md bg-cyan-400 px-4 py-2 font-medium text-slate-950" disabled={disabled} type="submit">
        Ask assistant
      </button>
    </form>
  )
}
```

```tsx
// src/features/ask-assistant/ui/AnswerPacketView.tsx
export default function AnswerPacketView({
  packet,
  onSelectCitation
}: {
  packet: {
    answerSummary: string
    answerSteps: string[]
    citations: Array<{ chunkId: string; pageNumber: number; citationLabel: string; assetId?: string }>
    supportingAssets: Array<{ assetId: string; pageNumber: number; label: string }>
    answerabilityStatus: string
  }
  onSelectCitation: (asset: { assetId: string; pageNumber: number; label: string }) => void
}) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm tracking-[0.3em] text-cyan-300 uppercase">{packet.answerabilityStatus}</p>
      <p className="text-base text-slate-100">{packet.answerSummary}</p>
      <ul className="space-y-2 text-sm text-slate-300">
        {packet.answerSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {packet.supportingAssets.map((asset) => (
          <button
            className="rounded-md border border-slate-700 px-3 py-2 text-sm"
            key={`${asset.assetId}:${asset.pageNumber}`}
            onClick={() => onSelectCitation(asset)}
            type="button"
          >
            {asset.label}
          </button>
        ))}
      </div>
    </section>
  )
}
```

```ts
// src/features/ask-assistant/ui/index.ts
export { default as QuestionComposer } from "./QuestionComposer"
export { default as AnswerPacketView } from "./AnswerPacketView"
```

```tsx
// src/features/view-evidence/ui/EvidenceViewer.tsx
import type { Id } from "@convex/_generated/dataModel"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

export default function EvidenceViewer({
  asset
}: {
  asset: { assetId: Id<"documentAssets">; pageNumber: number; label: string } | null
}) {
  const viewerAsset = useQuery(api.assets.resolveViewerAsset, asset ? { assetId: asset.assetId } : "skip")

  if (!asset)
    return (
      <div className="flex min-h-120 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-sm text-slate-400">
        Select a citation to open the official manual.
      </div>
    )
  if (viewerAsset === undefined)
    return <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">Loading evidence...</div>
  if (!viewerAsset)
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-rose-300">
        The supporting asset is unavailable.
      </div>
    )

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 px-4 py-3 text-sm text-slate-300">{asset.label}</div>
      <iframe className="h-180 w-full bg-white" src={`${viewerAsset.url}#page=${asset.pageNumber}`} title={asset.label} />
    </div>
  )
}
```

```ts
// src/features/view-evidence/ui/index.ts
export { default } from "./EvidenceViewer"
```

```tsx
// src/widgets/engineer-workspace/ui/EngineerWorkspace.tsx
import type { Id } from "@convex/_generated/dataModel"

import { startTransition, useState } from "react"

import { useAction } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { AnswerPacketView, QuestionComposer } from "@features/ask-assistant/ui"
import { AuthGate } from "@features/auth/ui"
import EvidenceViewer from "@features/view-evidence/ui/EvidenceViewer"

export default function EngineerWorkspace() {
  const ask = useAction(api.search.ask)
  const [sessionId, setSessionId] = useState<Id<"chatSessions"> | null>(null)
  const [packet, setPacket] = useState<null | {
    sessionId: Id<"chatSessions">
    answerabilityStatus: "grounded" | "insufficient_evidence"
    answerSummary: string
    answerSteps: string[]
    citations: Array<{ chunkId: Id<"chunks">; pageNumber: number; citationLabel: string; assetId?: Id<"documentAssets"> }>
    supportingAssets: Array<{ assetId: Id<"documentAssets">; pageNumber: number; label: string }>
  }>(null)
  const [activeAsset, setActiveAsset] = useState<{ assetId: Id<"documentAssets">; pageNumber: number; label: string } | null>(
    null
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <AuthGate>
      <AppShell title="Engineer Workspace">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
          <div className="space-y-6">
            <QuestionComposer
              disabled={isSubmitting}
              onSubmit={(question) => {
                setIsSubmitting(true)
                void ask({ question, sessionId: sessionId ?? undefined }).then((result) => {
                  startTransition(() => {
                    setSessionId(result.sessionId)
                    setPacket(result)
                    setActiveAsset(result.supportingAssets[0] ?? null)
                  })
                  setIsSubmitting(false)
                })
              }}
            />
            {packet && <AnswerPacketView packet={packet} onSelectCitation={setActiveAsset} />}
          </div>
          <EvidenceViewer asset={activeAsset} />
        </div>
      </AppShell>
    </AuthGate>
  )
}
```

```tsx
// src/widgets/engineer-workspace/island.tsx
import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import EngineerWorkspace from "./ui/EngineerWorkspace"

export default function EngineerWorkspaceIsland() {
  return (
    <ConvexProviderWrapper>
      <EngineerWorkspace />
    </ConvexProviderWrapper>
  )
}
```

```ts
// src/widgets/engineer-workspace/index.ts
export { default } from "./island"
```

- [ ] **Step 4: Run the UI tests and repo verification**

Run:

```bash
bunx vitest run src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx
bunx vitest run src/features/ask-assistant/ui/AnswerPacketView.test.tsx
bun run lint
```

Expected: both UI tests pass and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin-ingestion/ui/DocumentRegistrationForm.tsx src/features/admin-ingestion/ui/IngestionJobList.tsx src/features/admin-ingestion/ui/index.ts src/widgets/admin-console/ui/AdminConsole.tsx src/widgets/admin-console/island.tsx src/widgets/admin-console/index.ts src/entities/chat/model/types.ts src/entities/knowledge/model/types.ts src/features/ask-assistant/ui/QuestionComposer.tsx src/features/ask-assistant/ui/AnswerPacketView.tsx src/features/ask-assistant/ui/index.ts src/features/view-evidence/ui/EvidenceViewer.tsx src/features/view-evidence/ui/index.ts src/widgets/engineer-workspace/ui/EngineerWorkspace.tsx src/widgets/engineer-workspace/island.tsx src/widgets/engineer-workspace/index.ts src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx src/features/ask-assistant/ui/AnswerPacketView.test.tsx
git commit -m "feat(ui): add admin and engineer workspaces"
```

### Task 9: Evaluation Seeds and Manual Verification

**Files:**

- Create: `convex/lib/evaluationSeed.ts`
- Create: `convex/evaluations.ts`
- Test: `convex/lib/evaluationSeed.test.ts`
- Create: `docs/testing/sp1-manual-qa.md`

- [ ] **Step 1: Write the failing evaluation-seed test**

```ts
// convex/lib/evaluationSeed.test.ts
import { describe, expect, it } from "vitest"

import { defaultEvaluationCases } from "./evaluationSeed"

describe("defaultEvaluationCases", () => {
  it("covers the required SP1 categories", () => {
    expect(defaultEvaluationCases.map((item) => item.category)).toEqual(
      expect.arrayContaining(["exact-lookup", "table-reasoning", "diagram-reasoning", "not-found"])
    )
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bunx vitest run convex/lib/evaluationSeed.test.ts`

Expected: FAIL with `Cannot find module './evaluationSeed'`.

- [ ] **Step 3: Implement evaluation seeds and the manual QA checklist**

```ts
// convex/lib/evaluationSeed.ts
export const defaultEvaluationCases = [
  {
    slug: "guardlogix-partner-slot",
    question: "Where should the 1756-L7SP safety partner be installed relative to the primary controller?",
    category: "diagram-reasoning",
    severity: "safety-critical",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [9],
    expectedRefusal: false
  },
  {
    slug: "guardlogix-led-solid-red",
    question: "What does a solid red OK LED on the 1756-L7SP mean?",
    category: "table-reasoning",
    severity: "operational",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [45],
    expectedRefusal: false
  },
  {
    slug: "guardlogix-missing-evidence",
    question: "What is the torque value for terminal block X99 in this manual?",
    category: "not-found",
    severity: "informational",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [],
    expectedRefusal: true
  },
  {
    slug: "guardlogix-catalog-number",
    question: "Which catalog number corresponds to the safety partner module?",
    category: "exact-lookup",
    severity: "informational",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [9],
    expectedRefusal: false
  }
]
```

```ts
// convex/evaluations.ts
import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { defaultEvaluationCases } from "./lib/evaluationSeed"
import { requireAdminViewer } from "./lib/viewer"

export const list = query({
  args: {},
  returns: v.array(v.object({ slug: v.string(), question: v.string(), category: v.string(), expectedRefusal: v.boolean() })),
  handler: async (ctx) => await ctx.db.query("evaluationCases").collect()
})

export const seedDefaults = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdminViewer(ctx)
    let inserted = 0
    for (const item of defaultEvaluationCases) {
      const existing = await ctx.db
        .query("evaluationCases")
        .withIndex("by_slug", (q) => q.eq("slug", item.slug))
        .unique()
      if (existing) continue
      await ctx.db.insert("evaluationCases", item)
      inserted += 1
    }
    return inserted
  }
})
```

```md
<!-- docs/testing/sp1-manual-qa.md -->

# SP1 Manual QA Checklist

1. Sign in as an admin using password.
2. Queue the GuardLogix sample manual from an official vendor URL.
3. Confirm the ingestion job reaches `ready`.
4. Sign in as an engineer with an allowed account.
5. Ask: `Where should the 1756-L7SP safety partner be installed relative to the primary controller?`
6. Confirm the answer includes at least one citation.
7. Click the citation and verify the PDF viewer opens the cited page.
8. Ask: `What does a solid red OK LED on the 1756-L7SP mean?`
9. Confirm the answer is grounded and actionable.
10. Ask a deliberately unsupported question and confirm the assistant refuses instead of guessing.
```

- [ ] **Step 4: Run the evaluation-seed test and full repo verification**

Run:

```bash
bunx vitest run convex/lib/evaluationSeed.test.ts
bun run lint
```

Expected: evaluation seed test passes and repo verification exits 0.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/evaluationSeed.ts convex/lib/evaluationSeed.test.ts convex/evaluations.ts docs/testing/sp1-manual-qa.md
git commit -m "test(sp1): add evaluation seeds and qa guide"
```
