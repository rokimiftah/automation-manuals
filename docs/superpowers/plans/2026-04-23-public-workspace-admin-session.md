# Public Workspace and Minimal Admin Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the auth migration by making `/` the public engineer workspace and protecting `/admin` with a minimal server-enforced admin session flow.

**Architecture:** Keep the public product fully unauthenticated, remove the remaining fake anonymous-user model, and replace the old role-based Convex Auth integration with a narrow admin-only session boundary. Use a Node-backed Argon2id password verifier for admin sign-in, store only hashed session tokens in Convex, and protect every admin read/write function with explicit token checks.

**Tech Stack:** Astro 6, React 19 islands, Convex queries/mutations/actions, Node action runtime, `argon2`, Vitest, Testing Library, Biome, TypeScript

---

## File Structure

### Files to create

- `convex/lib/adminSession.ts` - shared admin auth helpers that do not require the Node runtime: env parsing, token hashing, login decision helpers, and session state helpers.
- `convex/adminAuth.ts` - public admin auth API and internal mutations/queries for storing, revoking, and validating admin sessions.
- `convex/adminAuthNode.ts` - Node-runtime internal action that verifies the admin password hash with Argon2id and creates a session.
- `convex/lib/adminSession.test.ts` - unit tests for admin env parsing, token hashing, session state helpers, and login decision logic.
- `scripts/hash-admin-password.mjs` - one-off helper for generating `ADMIN_PASSWORD_HASH` values.
- `src/features/admin-auth/ui/AdminLoginForm.tsx` - username/password form for `/admin`.
- `src/features/admin-auth/ui/AdminSessionGate.tsx` - local session state manager for `/admin` that reads `sessionStorage`, validates the token, and renders the login form or admin console.
- `src/features/admin-auth/ui/AdminSessionGate.test.tsx` - UI tests for admin sign-in, stale-session handling, and gate rendering.
- `src/features/admin-auth/ui/index.ts` - public UI exports for the admin-auth feature.

### Files to modify

- `package.json` - remove old auth dependencies and add `argon2`.
- `bun.lock` - dependency lockfile update after package changes.
- `convex/schema.ts` - remove `users`-based auth remnants, add admin session tables, and replace fake user-linked fields with explicit admin metadata.
- `convex/chats.ts` - remove `userId`-dependent chat storage and make chat session rows honest anonymous records.
- `convex/documents.ts` - require `sessionToken` for admin-only functions and write explicit admin audit metadata.
- `convex/ingestion.ts` - require `sessionToken` for admin-only functions and replace fake request users with admin session metadata.
- `convex/evaluations.ts` - protect `seedDefaults` with the new admin session helper.
- `src/shared/config/env.ts` - stop requiring `CONVEX_SITE_URL` in the client env.
- `src/shared/config/env.test.ts` - update env expectations for the reduced public env surface.
- `src/app/providers/ConvexProvider.tsx` - read only `CONVEX_URL` from `astro:env/client`.
- `astro.config.mjs` - expose only the public client env variables still used by the app.
- `src/widgets/app-shell/ui/AppShell.tsx` - keep the shell generic; the current admin dashboard does not expose session identity or a manual sign-out control.
- `src/widgets/admin-console/ui/AdminConsole.tsx` - accept `sessionToken` and pass it to every protected query/mutation.
- `src/widgets/admin-console/island.tsx` - render the admin session gate around the admin console.
- `src/pages/index.astro` - replace the marketing landing screen with the engineer workspace island.
- `.env.local.example` - remove Resend/allowlist auth variables and document `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_TTL_MS`.
- `README.md` - document the new public `/` + protected `/admin` behavior.
- `MIGRATION.md` - update the migration guide so it describes the final target architecture, not the transitional anonymous-user workaround.

### Files to delete

- `src/pages/app/index.astro` - the engineer workspace route moves to `/`.
- `src/widgets/app-shell/island.tsx` - no longer used after auth gate removal.
- `src/entities/auth/model/types.ts` - stale role/viewer type left over from the old auth design.

---

### Task 1: Add Admin Session Primitives and Env Cleanup

**Files:**

- Create: `convex/lib/adminSession.ts`
- Create: `convex/lib/adminSession.test.ts`
- Create: `scripts/hash-admin-password.mjs`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.env.local.example`
- Modify: `src/shared/config/env.ts`
- Modify: `src/shared/config/env.test.ts`
- Modify: `src/app/providers/ConvexProvider.tsx`
- Modify: `astro.config.mjs`

- [ ] **Step 1: Write the failing tests for admin auth primitives and reduced public env**

```ts
// convex/lib/adminSession.test.ts
import { describe, expect, it, vi } from "vitest"

import { authenticateAdminLogin, getAdminAuthEnv, getRateLimitState, hashSessionToken, isSessionStateValid } from "./adminSession"

describe("getAdminAuthEnv", () => {
  it("trims configured values and parses the ttl", () => {
    expect(
      getAdminAuthEnv({
        ADMIN_PASSWORD_HASH: "  $argon2id$v=19$m=19456,t=2,p=1$abc$def  ",
        ADMIN_SESSION_TTL_MS: " 1800000 ",
        ADMIN_USERNAME: "  admin  "
      })
    ).toEqual({
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def",
      sessionTtlMs: 1_800_000,
      username: "admin"
    })
  })

  it("throws when ADMIN_PASSWORD_HASH is missing", () => {
    expect(() => getAdminAuthEnv({ ADMIN_SESSION_TTL_MS: "1800000", ADMIN_USERNAME: "admin" })).toThrow(
      "ADMIN_PASSWORD_HASH is required"
    )
  })
})

describe("authenticateAdminLogin", () => {
  it("rejects a mismatched username without calling the password verifier", async () => {
    const verifyPasswordHash = vi.fn().mockResolvedValue(true)

    await expect(
      authenticateAdminLogin(
        {
          env: {
            passwordHash: "stored-hash",
            sessionTtlMs: 1_800_000,
            username: "admin"
          },
          password: "secret",
          username: "engineer"
        },
        { verifyPasswordHash }
      )
    ).resolves.toBeNull()

    expect(verifyPasswordHash).not.toHaveBeenCalled()
  })

  it("accepts a matching username when the password verifier succeeds", async () => {
    const verifyPasswordHash = vi.fn().mockResolvedValue(true)

    await expect(
      authenticateAdminLogin(
        {
          env: {
            passwordHash: "stored-hash",
            sessionTtlMs: 1_800_000,
            username: "admin"
          },
          password: "secret",
          username: " admin "
        },
        { verifyPasswordHash }
      )
    ).resolves.toEqual({ username: "admin" })
  })
})

describe("getRateLimitState", () => {
  it("marks the login flow limited once the failure threshold is reached", () => {
    expect(
      getRateLimitState({
        failures: [1_000, 2_000, 3_000, 4_000, 5_000],
        limit: 5,
        now: 5_500,
        windowMs: 60_000
      })
    ).toEqual({
      limitedUntil: 61_000,
      retryAfterMs: 55_500
    })
  })
})

describe("hashSessionToken", () => {
  it("returns a stable sha256 hex digest", async () => {
    await expect(hashSessionToken("session-token")).resolves.toMatch(/^[a-f0-9]{64}$/)
  })
})

describe("isSessionStateValid", () => {
  it("rejects revoked or expired sessions", () => {
    expect(isSessionStateValid({ expiresAt: 1_000, now: 1_000, revokedAt: undefined })).toBe(false)
    expect(isSessionStateValid({ expiresAt: 2_000, now: 1_000, revokedAt: 500 })).toBe(false)
    expect(isSessionStateValid({ expiresAt: 2_000, now: 1_000, revokedAt: undefined })).toBe(true)
  })
})
```

```ts
// src/shared/config/env.test.ts
import { describe, expect, it } from "vitest"

import { getPublicAppEnv } from "./env"

describe("getPublicAppEnv", () => {
  it("returns a trimmed convexUrl", () => {
    expect(getPublicAppEnv({ CONVEX_URL: "  https://convex.example  " })).toEqual({
      convexUrl: "https://convex.example"
    })
  })

  it("throws when CONVEX_URL is missing", () => {
    expect(() => getPublicAppEnv({})).toThrow("CONVEX_URL is required")
  })
})
```

- [ ] **Step 2: Run the focused tests to verify they fail for the expected reasons**

Run: `bunx vitest run convex/lib/adminSession.test.ts src/shared/config/env.test.ts`

Expected: FAIL because `convex/lib/adminSession.ts` does not exist yet and `getPublicAppEnv` still requires `CONVEX_SITE_URL`.

- [ ] **Step 3: Install the new password hashing dependency and remove the old auth packages**

Run: `bun add argon2 && bun remove @auth/core @convex-dev/auth`

Expected: PASS with `argon2` added to dependencies, old auth packages removed from `package.json`, and `bun.lock` updated.

- [ ] **Step 4: Implement the admin auth primitives, password-hash generator script, and public env cleanup**

```ts
// convex/lib/adminSession.ts
const encoder = new TextEncoder()

export type AdminAuthEnvInput = {
  ADMIN_PASSWORD_HASH?: string
  ADMIN_SESSION_TTL_MS?: string
  ADMIN_USERNAME?: string
}

export type AdminAuthEnv = {
  passwordHash: string
  sessionTtlMs: number
  username: string
}

export function getAdminAuthEnv(input: AdminAuthEnvInput = process.env): AdminAuthEnv {
  const username = input.ADMIN_USERNAME?.trim()
  if (!username) {
    throw new Error("ADMIN_USERNAME is required")
  }

  const passwordHash = input.ADMIN_PASSWORD_HASH?.trim()
  if (!passwordHash) {
    throw new Error("ADMIN_PASSWORD_HASH is required")
  }

  const ttlRaw = input.ADMIN_SESSION_TTL_MS?.trim()
  const ttl = ttlRaw ? Number(ttlRaw) : 1_800_000
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("ADMIN_SESSION_TTL_MS must be a positive integer")
  }

  return {
    passwordHash,
    sessionTtlMs: Math.floor(ttl),
    username: username.toLowerCase()
  }
}

export async function hashSessionToken(sessionToken: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(sessionToken))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function authenticateAdminLogin(
  input: {
    env: AdminAuthEnv
    password: string
    username: string
  },
  deps: {
    verifyPasswordHash: (passwordHash: string, password: string) => Promise<boolean>
  }
) {
  const normalizedUsername = input.username.trim().toLowerCase()
  if (normalizedUsername !== input.env.username) {
    return null
  }

  const password = input.password.trim()
  if (!password) {
    return null
  }

  const verified = await deps.verifyPasswordHash(input.env.passwordHash, password)
  return verified ? { username: input.env.username } : null
}

export function getRateLimitState(input: { failures: number[]; limit: number; now: number; windowMs: number }) {
  if (input.failures.length < input.limit) {
    return null
  }

  const earliestFailure = input.failures[0]
  if (earliestFailure === undefined) {
    return null
  }

  const limitedUntil = earliestFailure + input.windowMs
  return {
    limitedUntil,
    retryAfterMs: Math.max(0, limitedUntil - input.now)
  }
}

export function isSessionStateValid(input: { expiresAt: number; now: number; revokedAt?: number }) {
  return input.revokedAt === undefined && input.now < input.expiresAt
}
```

```js
// scripts/hash-admin-password.mjs
import argon2 from "argon2"

const password = process.argv[2]?.trim()

if (!password) {
  console.error('Usage: node scripts/hash-admin-password.mjs "your-strong-password"')
  process.exit(1)
}

const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
})

console.log(hash)
```

```ts
// src/shared/config/env.ts
export type PublicAppEnvInput = {
  CONVEX_URL?: string
}

export type PublicAppEnv = {
  convexUrl: string
}

export function getPublicAppEnv({ CONVEX_URL }: PublicAppEnvInput): PublicAppEnv {
  const convexUrl = CONVEX_URL?.trim()
  if (!convexUrl) {
    throw new Error("CONVEX_URL is required")
  }

  return { convexUrl }
}
```

```tsx
// src/app/providers/ConvexProvider.tsx
import type { ReactNode } from "react"

import { ConvexProvider as ConvexProviderBase, ConvexReactClient } from "convex/react"

import { CONVEX_URL } from "astro:env/client"

import { getPublicAppEnv } from "@shared/config/env"

const { convexUrl } = getPublicAppEnv({ CONVEX_URL })

const client = new ConvexReactClient(convexUrl)

export function ConvexProviderWrapper({ children }: { children: ReactNode }) {
  return <ConvexProviderBase client={client}>{children}</ConvexProviderBase>
}

export { client }
```

```js
// astro.config.mjs
env: {
  schema: {
    CONVEX_URL: envField.string({ access: "public", context: "client" })
  }
}
```

```env
# .env.local.example (replace the old auth sections with this admin section)
# ============================================================================
# Admin console session auth
# ============================================================================
# What it is:
# - Minimal admin-only login for the `/admin` route.
# How to get it:
# - Pick a strong username.
# - Generate an Argon2id hash for the password with:
#   `node scripts/hash-admin-password.mjs "your-strong-password"`
# - Store only the generated hash below.

ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_TTL_MS=1800000
```

- [ ] **Step 5: Run the focused tests again**

Run: `bunx vitest run convex/lib/adminSession.test.ts src/shared/config/env.test.ts`

Expected: PASS for all admin primitive tests and the reduced public env tests.

- [ ] **Step 6: Commit the primitive layer and env cleanup**

```bash
git add package.json bun.lock convex/lib/adminSession.ts convex/lib/adminSession.test.ts scripts/hash-admin-password.mjs src/shared/config/env.ts src/shared/config/env.test.ts src/app/providers/ConvexProvider.tsx astro.config.mjs .env.local.example
git commit -m "refactor(auth): add admin session primitives"
```

### Task 2: Wire Convex Backend to Admin Sessions and Honest Public Data

**Files:**

- Create: `convex/adminAuth.ts`
- Create: `convex/adminAuthNode.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/chats.ts`
- Modify: `convex/documents.ts`
- Modify: `convex/ingestion.ts`
- Modify: `convex/evaluations.ts`
- Modify: `convex/lib/adminSession.ts`
- Modify: `convex/lib/adminSession.test.ts`

- [ ] **Step 1: Extend the failing tests with audit-actor coverage for the backend wiring**

```ts
// append to convex/lib/adminSession.test.ts
describe("buildAdminAuditActor", () => {
  it("maps an admin session to stable audit metadata", () => {
    expect(buildAdminAuditActor({ _id: "adminSessions_7" as never, username: "root" })).toEqual({
      actorLabel: "root",
      actorType: "admin_session",
      adminSessionId: "adminSessions_7"
    })
  })
})
```

- [ ] **Step 2: Run the focused admin helper tests and confirm the new audit case fails first**

Run: `bunx vitest run convex/lib/adminSession.test.ts`

Expected: FAIL until `buildAdminAuditActor` is added and the backend snippets start using it.

- [ ] **Step 3: Implement the admin auth Convex functions, schema migration, and backend protection boundaries**

```ts
// convex/schema.ts (replace the auth-era user/session fields)
export default defineSchema({
  adminSessions: defineTable({
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    tokenHash: v.string(),
    username: v.string()
  }).index("by_token_hash", ["tokenHash"]),
  adminLoginAttempts: defineTable({
    createdAt: v.number(),
    successful: v.boolean(),
    username: v.string()
  }).index("by_username_and_created_at", ["username", "createdAt"]),
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
    createdByAdmin: v.string()
  })
    .index("by_product", ["productId"])
    .index("by_product_and_active", ["productId", "isActive"]),
  ingestionJobs: defineTable({
    documentId: v.id("documents"),
    requestedByAdmin: v.string(),
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
    priorityQuotaBucket: v.optional(
      v.union(v.literal("priority_expected"), v.literal("standard_possible"), v.literal("unknown"))
    ),
    sourceStorageId: v.optional(v.id("_storage")),
    sourceFileName: v.optional(v.string()),
    sourceMimeType: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_document", ["documentId"])
    .index("by_provider_batch_id", ["providerBatchId"]),
  chatSessions: defineTable({
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  }),
  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    role: messageRoleValidator,
    content: v.string(),
    answerabilityStatus: v.optional(answerabilityStatusValidator),
    createdAt: v.number()
  }).index("by_session", ["sessionId"]),
  auditEvents: defineTable({
    actorLabel: v.string(),
    actorType: v.string(),
    adminSessionId: v.optional(v.id("adminSessions")),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    summary: v.string(),
    createdAt: v.number()
  }).index("by_actor_type", ["actorType"])
})
```

```ts
// convex/lib/adminSession.ts (add the Convex-facing helpers)
import type { MutationCtx, QueryCtx } from "../_generated/server"

import { ConvexError } from "convex/values"

type AdminReadCtx = QueryCtx | MutationCtx

export async function loadAdminSession(ctx: AdminReadCtx, sessionToken: string) {
  const tokenHash = await hashSessionToken(sessionToken)
  return await ctx.db
    .query("adminSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique()
}

export async function requireAdminQuerySession(ctx: QueryCtx | MutationCtx, sessionToken: string) {
  const session = await loadAdminSession(ctx, sessionToken)
  if (!session || session.revokedAt !== undefined) {
    throw new ConvexError("Admin session required")
  }

  return session
}

export async function requireAdminWriteSession(ctx: MutationCtx, sessionToken: string) {
  const session = await loadAdminSession(ctx, sessionToken)
  if (!session || !isSessionStateValid({ expiresAt: session.expiresAt, now: Date.now(), revokedAt: session.revokedAt })) {
    throw new ConvexError("Admin session expired")
  }

  return session
}

export function buildAdminAuditActor(session: { _id: string; username: string }) {
  return {
    actorLabel: session.username,
    actorType: "admin_session",
    adminSessionId: session._id
  }
}
```

```ts
// convex/adminAuth.ts
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { buildAdminAuditActor, hashSessionToken, loadAdminSession, requireAdminQuerySession } from "./lib/adminSession"

const adminSessionViewValidator = v.object({
  expiresAt: v.number(),
  username: v.string()
})

export const signIn = action({
  args: {
    password: v.string(),
    username: v.string()
  },
  returns: v.object({
    expiresAt: v.number(),
    sessionToken: v.string(),
    username: v.string()
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.adminAuthNode.signInWithPassword, args)
  }
})

export const validateSession = query({
  args: { sessionToken: v.string() },
  returns: v.union(v.null(), adminSessionViewValidator),
  handler: async (ctx, args) => {
    const session = await loadAdminSession(ctx, args.sessionToken)
    if (!session || session.revokedAt !== undefined) {
      return null
    }

    return {
      expiresAt: session.expiresAt,
      username: session.username
    }
  }
})

export const signOut = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireAdminQuerySession(ctx, args.sessionToken)

    await ctx.db.patch("adminSessions", session._id, { revokedAt: Date.now() })
    await ctx.db.insert("auditEvents", {
      ...buildAdminAuditActor(session),
      action: "admin.sign_out",
      targetTable: "adminSessions",
      targetId: session._id,
      summary: `Signed out ${session.username}`,
      createdAt: Date.now()
    })

    return null
  }
})

export const listRecentLoginAttempts = internalQuery({
  args: {
    username: v.string(),
    windowStart: v.number()
  },
  returns: v.array(v.object({ createdAt: v.number(), successful: v.boolean() })),
  handler: async (ctx, args) => {
    const attempts = await ctx.db
      .query("adminLoginAttempts")
      .withIndex("by_username_and_created_at", (q) => q.eq("username", args.username).gte("createdAt", args.windowStart))
      .collect()

    return attempts.map((attempt) => ({
      createdAt: attempt.createdAt,
      successful: attempt.successful
    }))
  }
})

export const recordLoginAttempt = internalMutation({
  args: {
    successful: v.boolean(),
    username: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("adminLoginAttempts", {
      createdAt: Date.now(),
      successful: args.successful,
      username: args.username
    })
    return null
  }
})

export const createSession = internalMutation({
  args: {
    expiresAt: v.number(),
    sessionToken: v.string(),
    username: v.string()
  },
  returns: v.id("adminSessions"),
  handler: async (ctx, args) => {
    const tokenHash = await hashSessionToken(args.sessionToken)
    const createdAt = Date.now()

    const sessionId = await ctx.db.insert("adminSessions", {
      createdAt,
      expiresAt: args.expiresAt,
      tokenHash,
      username: args.username
    })

    await ctx.db.insert("auditEvents", {
      ...buildAdminAuditActor({ _id: sessionId, username: args.username }),
      action: "admin.sign_in",
      targetTable: "adminSessions",
      targetId: sessionId,
      summary: `Signed in ${args.username}`,
      createdAt
    })

    await ctx.scheduler.runAfter(Math.max(0, args.expiresAt - createdAt), internal.adminAuth.expireSession, { sessionId })
    return sessionId
  }
})

export const expireSession = internalMutation({
  args: { sessionId: v.id("adminSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("adminSessions", args.sessionId)
    if (!session || session.revokedAt !== undefined) {
      return null
    }

    await ctx.db.patch("adminSessions", args.sessionId, { revokedAt: Date.now() })
    return null
  }
})
```

```ts
// convex/adminAuthNode.ts
"use node"

import { randomBytes } from "node:crypto"

import { ConvexError, v } from "convex/values"

import argon2 from "argon2"

import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { authenticateAdminLogin, getAdminAuthEnv, getRateLimitState } from "./lib/adminSession"

const LOGIN_LIMIT = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

export const signInWithPassword = internalAction({
  args: {
    password: v.string(),
    username: v.string()
  },
  returns: v.object({
    expiresAt: v.number(),
    sessionToken: v.string(),
    username: v.string()
  }),
  handler: async (ctx, args) => {
    const env = getAdminAuthEnv()
    const now = Date.now()

    const attempts = await ctx.runQuery(internal.adminAuth.listRecentLoginAttempts, {
      username: env.username,
      windowStart: now - LOGIN_WINDOW_MS
    })

    const failures = attempts.filter((attempt) => !attempt.successful).map((attempt) => attempt.createdAt)
    const rateLimitState = getRateLimitState({
      failures,
      limit: LOGIN_LIMIT,
      now,
      windowMs: LOGIN_WINDOW_MS
    })
    if (rateLimitState) {
      throw new ConvexError("Too many login attempts. Please try again later.")
    }

    const login = await authenticateAdminLogin(
      {
        env,
        password: args.password,
        username: args.username
      },
      {
        verifyPasswordHash: (passwordHash, password) => argon2.verify(passwordHash, password)
      }
    )

    if (!login) {
      await ctx.runMutation(internal.adminAuth.recordLoginAttempt, { successful: false, username: env.username })
      throw new ConvexError("Invalid admin credentials")
    }

    const sessionToken = randomBytes(32).toString("base64url")
    const expiresAt = now + env.sessionTtlMs

    await ctx.runMutation(internal.adminAuth.recordLoginAttempt, { successful: true, username: env.username })
    await ctx.runMutation(internal.adminAuth.createSession, {
      expiresAt,
      sessionToken,
      username: login.username
    })

    return {
      expiresAt,
      sessionToken,
      username: login.username
    }
  }
})
```

```ts
// convex/documents.ts (admin protection and honest metadata)
import { buildAdminAuditActor, requireAdminQuerySession, requireAdminWriteSession } from "./lib/adminSession"

export const listAdmin = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      isActive: v.boolean(),
      productSlug: v.string(),
      status: documentStatusValidator,
      title: v.string(),
      vendorSlug: v.string(),
      version: v.string()
    })
  ),
  handler: async (ctx, args) => {
    await requireAdminQuerySession(ctx, args.sessionToken)
    const documents = await ctx.db.query("documents").collect()
    return documents.map((doc) => ({
      _id: doc._id,
      isActive: doc.isActive,
      productSlug: doc.productSlug,
      status: doc.status,
      title: doc.title,
      vendorSlug: doc.vendorSlug,
      version: doc.version
    }))
  }
})

export const create = mutation({
  args: {
    language: v.string(),
    productName: v.string(),
    sessionToken: v.string(),
    sourceUrl: v.string(),
    title: v.string(),
    vendorName: v.string(),
    version: v.string()
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const vendorName = requireText("vendorName", args.vendorName)
    const productName = requireText("productName", args.productName)
    const title = requireText("title", args.title)
    const version = requireText("version", args.version)
    const language = requireText("language", args.language)
    const sourceUrl = requireHttpUrl("sourceUrl", args.sourceUrl)
    const now = Date.now()
    const vendorId = await upsertVendor(ctx, vendorName)
    const productId = await upsertProduct(ctx, vendorId, productName)
    const documentId = await ctx.db.insert("documents", {
      vendorId,
      productId,
      vendorSlug: toSlug(vendorName),
      productSlug: toSlug(productName),
      title,
      version,
      language,
      sourceUrl,
      status: "draft",
      createdByAdmin: adminSession.username,
      isActive: false,
      createdAt: now,
      updatedAt: now
    })

    await ctx.db.insert("auditEvents", {
      ...buildAdminAuditActor(adminSession),
      action: "document.create",
      targetTable: "documents",
      targetId: documentId,
      summary: `Created ${title} ${version}`,
      createdAt: now
    })

    return documentId
  }
})
```

```ts
// convex/ingestion.ts (protect admin-only reads/writes)
import { requireAdminQuerySession, requireAdminWriteSession } from "./lib/adminSession"

export const listJobs = query({
  args: { sessionToken: v.string() },
  returns: v.array(listJobValidator),
  handler: async (ctx, args) => {
    await requireAdminQuerySession(ctx, args.sessionToken)
    const jobs = await ctx.db.query("ingestionJobs").collect()
    return jobs.map((job) => ({
      _id: job._id,
      documentId: job.documentId,
      ...(job.errorMessage === undefined ? {} : { errorMessage: job.errorMessage }),
      ...(job.providerErrorCode === undefined ? {} : { providerErrorCode: job.providerErrorCode }),
      ...(job.providerErrorMessage === undefined ? {} : { providerErrorMessage: job.providerErrorMessage }),
      ...(job.providerLastCheckedAt === undefined ? {} : { providerLastCheckedAt: job.providerLastCheckedAt }),
      ...(job.providerState === undefined ? {} : { providerState: job.providerState }),
      status: job.status
    }))
  }
})

export const enqueue = mutation({
  args: { documentId: v.id("documents"), sessionToken: v.string() },
  returns: v.id("ingestionJobs"),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    const now = Date.now()
    const jobId = await ctx.db.insert("ingestionJobs", {
      createdAt: now,
      documentId: args.documentId,
      requestedByAdmin: adminSession.username,
      status: "queued",
      updatedAt: now
    })

    await ctx.scheduler.runAfter(0, internal.ingestion.runDocumentJob, {
      documentId: args.documentId,
      jobId
    })

    return jobId
  }
})
```

```ts
// convex/evaluations.ts
import { requireAdminWriteSession } from "./lib/adminSession"

export const seedDefaults = mutation({
  args: { sessionToken: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireAdminWriteSession(ctx, args.sessionToken)
    let inserted = 0
    for (const item of defaultEvaluationCases) {
      const existing = await ctx.db
        .query("evaluationCases")
        .withIndex("by_slug", (q) => q.eq("slug", item.slug))
        .unique()

      if (existing) {
        continue
      }

      await ctx.db.insert("evaluationCases", item)
      inserted += 1
    }

    return inserted
  }
})
```

```ts
// convex/chats.ts (remove fake user IDs)
export const ensureSession = internalMutation({
  args: { title: v.string() },
  returns: v.id("chatSessions"),
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert("chatSessions", {
      createdAt: now,
      title: args.title.slice(0, 120) || "New chat",
      updatedAt: now
    })
  }
})

export const appendMessage = internalMutation({
  args: {
    answerabilityStatus: v.optional(v.union(v.literal("grounded"), v.literal("insufficient_evidence"))),
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

- [ ] **Step 4: Run the focused backend tests again**

Run: `bunx vitest run convex/lib/adminSession.test.ts`

Expected: PASS for all admin helper tests, including active-session and expiry coverage.

- [ ] **Step 5: Commit the backend migration**

```bash
git add convex/schema.ts convex/adminAuth.ts convex/adminAuthNode.ts convex/lib/adminSession.ts convex/lib/adminSession.test.ts convex/chats.ts convex/documents.ts convex/ingestion.ts convex/evaluations.ts
git commit -m "feat(admin): add session-protected backend"
```

### Task 3: Move the Workspace to `/` and Add the Admin UI Gate

**Files:**

- Create: `src/features/admin-auth/ui/AdminLoginForm.tsx`
- Create: `src/features/admin-auth/ui/AdminSessionGate.tsx`
- Create: `src/features/admin-auth/ui/AdminSessionGate.test.tsx`
- Create: `src/features/admin-auth/ui/index.ts`
- Modify: `src/widgets/app-shell/ui/AppShell.tsx`
- Modify: `src/widgets/admin-console/ui/AdminConsole.tsx`
- Modify: `src/widgets/admin-console/island.tsx`
- Modify: `src/pages/index.astro`
- Delete: `src/pages/app/index.astro`
- Delete: `src/widgets/app-shell/island.tsx`
- Delete: `src/entities/auth/model/types.ts`

- [ ] **Step 1: Write the failing admin gate tests first**

```tsx
// src/features/admin-auth/ui/AdminSessionGate.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AdminSessionGate } from "./AdminSessionGate"

const signIn = vi.fn()
const signOut = vi.fn()
const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useAction: () => signIn,
  useMutation: () => signOut,
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

describe("AdminSessionGate", () => {
  beforeEach(() => {
    sessionStorage.clear()
    signIn.mockReset()
    signOut.mockReset()
    useQuery.mockReset()
  })

  it("shows the login form when no session token exists", () => {
    useQuery.mockReturnValue("skip")

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument()
    expect(screen.queryByText("Admin console")).not.toBeInTheDocument()
  })

  it("stores the returned session token and renders children after sign in", async () => {
    useQuery.mockReturnValueOnce("skip").mockReturnValue({ expiresAt: 123_456, username: "admin" })
    signIn.mockResolvedValue({ expiresAt: 123_456, sessionToken: "token-123", username: "admin" })

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "admin" } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "correct horse battery staple" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBe("token-123"))
    expect(await screen.findByText("Admin console")).toBeInTheDocument()
  })

  it("clears a stale stored token when session validation returns null", async () => {
    sessionStorage.setItem("adminSessionToken", "stale-token")
    useQuery.mockReturnValue(null)

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBeNull())
    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the admin gate test and confirm it fails before the components exist**

Run: `bunx vitest run src/features/admin-auth/ui/AdminSessionGate.test.tsx`

Expected: FAIL because `AdminSessionGate` and `AdminLoginForm` do not exist yet.

- [ ] **Step 3: Implement the admin login UI, gate, route move, and admin token wiring**

```tsx
// src/features/admin-auth/ui/AdminLoginForm.tsx
import { useState } from "react"

export function AdminLoginForm({
  error,
  onSubmit,
  pending
}: {
  error?: string
  onSubmit: (input: { password: string; username: string }) => Promise<void>
  pending: boolean
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  return (
    <section className="mx-auto max-w-md space-y-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          await onSubmit({ password, username })
        }}
      >
        <label className="block space-y-2 text-sm text-slate-200">
          <span>ID String</span>
          <input
            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="block space-y-2 text-sm text-slate-200">
          <span>Passphrase</span>
          <input
            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:bg-slate-700 disabled:text-slate-300"
          disabled={pending}
          type="submit"
        >
          {pending ? "Verifying" : "Access"}
        </button>
      </form>
    </section>
  )
}
```

```tsx
// src/features/admin-auth/ui/AdminSessionGate.tsx
import type { ReactNode } from "react"

import { useEffect, useState } from "react"

import { useAction, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import { AdminLoginForm } from "./AdminLoginForm"

const STORAGE_KEY = "adminSessionToken"

export function AdminSessionGate({
  children
}: {
  children: (session: { expiresAt: number; onSessionInvalid: (message?: string) => void; sessionToken: string }) => ReactNode
}) {
  const signIn = useAction(api.adminAuth.signIn)
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  useEffect(() => {
    setSessionToken(sessionStorage.getItem(STORAGE_KEY))
  }, [])

  const session = useQuery(api.adminAuth.validateSession, sessionToken ? { sessionToken } : "skip")

  useEffect(() => {
    if (sessionToken && session === null) {
      sessionStorage.removeItem(STORAGE_KEY)
      setSessionToken(null)
      setError("Admin session expired. Please sign in again.")
    }
  }, [session, sessionToken])

  if (!sessionToken) {
    return (
      <AdminLoginForm
        error={error}
        pending={isPending}
        onSubmit={async (input) => {
          setError(undefined)
          setIsPending(true)
          try {
            const result = await signIn(input)
            sessionStorage.setItem(STORAGE_KEY, result.sessionToken)
            setSessionToken(result.sessionToken)
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Unable to sign in.")
          } finally {
            setIsPending(false)
          }
        }}
      />
    )
  }

  if (session === undefined) {
    return null
  }

  if (!session) {
    return null
  }

  return children({
    expiresAt: session.expiresAt,
    onSessionInvalid: (message = "Admin session expired. Please sign in again.") => {
      sessionStorage.removeItem(STORAGE_KEY)
      setSessionToken(null)
      setError(message)
    },
    sessionToken
  })
}
```

```tsx
// src/widgets/app-shell/ui/AppShell.tsx
import type { ReactNode } from "react"

export default function AppShell({ actions, children, title }: { actions?: ReactNode; children: ReactNode; title: string }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-[0.45em] text-cyan-300 uppercase">Automation Manuals</p>
            <h1 className="text-2xl font-semibold text-white">{title}</h1>
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  )
}
```

```tsx
// src/widgets/admin-console/ui/AdminConsole.tsx
import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { DocumentRegistrationForm, IngestionJobList } from "@features/admin-ingestion/ui"

export default function AdminConsole({
  onSessionInvalid,
  sessionToken
}: {
  onSessionInvalid: (message?: string) => void
  sessionToken: string
}) {
  const documents = useQuery(api.documents.listAdmin, { sessionToken })
  const jobs = useQuery(api.ingestion.listJobs, { sessionToken })
  const createDocument = useMutation(api.documents.create)
  const enqueue = useMutation(api.ingestion.enqueue)
  const retryJob = useMutation(api.ingestion.retry)

  async function runProtectedMutation<T>(work: () => Promise<T>) {
    try {
      return await work()
    } catch (error) {
      if (error instanceof Error && /admin session/i.test(error.message)) {
        onSessionInvalid("Admin session expired. Please sign in again.")
      }

      throw error
    }
  }

  return (
    <AppShell title="Admin Interface">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Document inventory</p>
              <h2 className="text-2xl font-semibold text-white">Registered manuals</h2>
              <p className="text-sm leading-6 text-slate-400">Approved source documents ready for ingestion and retrieval.</p>
            </div>
            <p className="mt-5 font-mono text-4xl font-semibold tracking-tight text-white">
              {documents === undefined ? "—" : documents.length}
            </p>
          </section>

          <DocumentRegistrationForm
            onSubmit={async (values) => {
              await runProtectedMutation(async () => {
                const documentId = await createDocument({ ...values, sessionToken })
                await enqueue({ documentId, sessionToken })
              })
            }}
          />
        </div>

        <div className="space-y-6">
          {jobs === undefined ? (
            <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Ingestion jobs</p>
                <h2 className="text-2xl font-semibold text-white">Queue status</h2>
                <p className="text-sm leading-6 text-slate-400">Loading job history...</p>
              </div>
              <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-950/60" />
            </section>
          ) : (
            <IngestionJobList
              jobs={jobs}
              onRetry={(jobId) => {
                void runProtectedMutation(() => retryJob({ jobId, sessionToken }))
              }}
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}
```

```tsx
// src/widgets/admin-console/island.tsx
import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import { AdminSessionGate } from "@features/admin-auth/ui"

import AdminConsole from "./ui/AdminConsole"

export default function AdminConsoleIsland() {
  return (
    <ConvexProviderWrapper>
      <AdminSessionGate>
        {(session) => <AdminConsole onSessionInvalid={session.onSessionInvalid} sessionToken={session.sessionToken} />}
      </AdminSessionGate>
    </ConvexProviderWrapper>
  )
}
```

```astro
---
import Layout from "@/layouts/Layout.astro"

import EngineerWorkspaceIsland from "@widgets/engineer-workspace"
---

<Layout title="Engineer Workspace | Automation Manuals">
  <EngineerWorkspaceIsland client:load />
</Layout>
```

- [ ] **Step 4: Delete the stale route and stale auth leftovers with a patch**

```diff
*** Begin Patch
*** Delete File: src/pages/app/index.astro
*** Delete File: src/widgets/app-shell/island.tsx
*** Delete File: src/entities/auth/model/types.ts
*** End Patch
```

- [ ] **Step 5: Run the UI tests again**

Run: `bunx vitest run src/features/admin-auth/ui/AdminSessionGate.test.tsx src/features/admin-ingestion/ui/DocumentRegistrationForm.test.tsx src/features/admin-ingestion/ui/IngestionJobList.test.tsx`

Expected: PASS for the admin gate tests and the existing admin-ingestion component tests.

- [ ] **Step 6: Commit the route move and admin UI gate**

```bash
git add src/features/admin-auth/ui/AdminLoginForm.tsx src/features/admin-auth/ui/AdminSessionGate.tsx src/features/admin-auth/ui/AdminSessionGate.test.tsx src/features/admin-auth/ui/index.ts src/widgets/app-shell/ui/AppShell.tsx src/widgets/admin-console/ui/AdminConsole.tsx src/widgets/admin-console/island.tsx src/pages/index.astro
git add -u src/pages/app/index.astro src/widgets/app-shell/island.tsx src/entities/auth/model/types.ts
git commit -m "refactor(ui): move workspace public"
```

### Task 4: Update Migration Docs and Run Full Verification

**Files:**

- Modify: `README.md`
- Modify: `MIGRATION.md`
- Modify: `.env.local.example`

- [ ] **Step 1: Rewrite the live documentation to match the final architecture**

```md
<!-- README.md: update the feature and getting-started sections -->

- `/` is the public engineer workspace.
- `/admin` is protected by minimal admin session auth.
- End-user accounts, role gates, and Convex Auth are no longer part of the runtime architecture.
- Admin credentials are configured with `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_TTL_MS`.
```

```md
<!-- MIGRATION.md: replace the transitional anonymous-user story with the final migration story -->

1. Remove `@convex-dev/auth` and `@auth/core`.
2. Remove the old auth routes and UI gates.
3. Replace fake anonymous user IDs with honest public records and explicit admin metadata.
4. Add `adminSessions` and `adminLoginAttempts` tables.
5. Generate `ADMIN_PASSWORD_HASH` with `node scripts/hash-admin-password.mjs "your-strong-password"`.
6. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_TTL_MS` in the Convex dashboard.
7. Confirm `/` is public and `/admin` requires login.
```

- [ ] **Step 2: Search for stale auth-era references in the live app surface**

Run: `rg "@convex-dev/auth|AUTH_RESEND_KEY|AUTH_EMAIL_FROM|ADMIN_EMAILS|ALLOWED_EMAILS|ALLOWED_EMAIL_DOMAINS|/auth\b|/app\b" README.md MIGRATION.md src convex package.json .env.local.example`

Expected: no matches in live application files, except intentional mentions inside the migration guide describing what was removed.

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`

Expected: PASS with all `src/**/*.test.ts`, `src/**/*.test.tsx`, and `convex/**/*.test.ts` tests green.

- [ ] **Step 4: Run lint and type checks**

Run: `bun run lint`

Expected: PASS with zero Biome issues and zero TypeScript errors, including the Convex project typecheck.

- [ ] **Step 5: Run the production build**

Run: `bun run build`

Expected: PASS with Astro build completion and no route/import errors after deleting `/app` and the old auth leftovers.

- [ ] **Step 6: Commit the docs and verification pass**

```bash
git add README.md MIGRATION.md .env.local.example
git commit -m "docs(auth): document public workspace migration"
```
