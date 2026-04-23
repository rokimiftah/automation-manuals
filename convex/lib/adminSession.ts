import type { MutationCtx, QueryCtx } from "../_generated/server"

import { ConvexError } from "convex/values"

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

export function getAdminLoginAttemptUsername(username: string) {
  return username.trim().toLowerCase()
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
  if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl <= 0) {
    throw new Error("ADMIN_SESSION_TTL_MS must be a positive integer")
  }

  return {
    passwordHash,
    sessionTtlMs: ttl,
    username: getAdminLoginAttemptUsername(username)
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
  const normalizedUsername = getAdminLoginAttemptUsername(input.username)
  if (normalizedUsername !== input.env.username) {
    return null
  }

  if (!input.password) {
    return null
  }

  const verified = await deps.verifyPasswordHash(input.env.passwordHash, input.password)
  return verified ? { username: input.env.username } : null
}

export function getRateLimitState(input: {
  // Assumes failures array is sorted by timestamp (oldest first)
  failures: number[]
  limit: number
  now: number
  windowMs: number
}) {
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

type AdminReadCtx = QueryCtx | MutationCtx

export async function loadAdminSession(ctx: AdminReadCtx, sessionToken: string) {
  const tokenHash = await hashSessionToken(sessionToken)
  return await ctx.db
    .query("adminSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique()
}

export async function loadValidAdminSession(ctx: AdminReadCtx, sessionToken: string, now = Date.now()) {
  const session = await loadAdminSession(ctx, sessionToken)
  if (!session || !isSessionStateValid({ expiresAt: session.expiresAt, now, revokedAt: session.revokedAt })) {
    return null
  }

  return session
}

export async function requireAdminQuerySession(ctx: QueryCtx | MutationCtx, sessionToken: string, now = Date.now()) {
  const session = await loadValidAdminSession(ctx, sessionToken, now)
  if (!session) {
    throw new ConvexError("Admin session required")
  }

  return session
}

export async function requireAdminWriteSession(ctx: MutationCtx, sessionToken: string, now = Date.now()) {
  const session = await loadValidAdminSession(ctx, sessionToken, now)
  if (!session) {
    throw new ConvexError("Admin session expired")
  }

  return session
}

export async function revokeAdminSession(ctx: MutationCtx, sessionId: string, revokedAt = Date.now()) {
  await ctx.db.patch("adminSessions", sessionId as never, { revokedAt })
}

export function buildAdminAuditActor(session: { _id: string; username: string }) {
  return {
    actorLabel: session.username,
    actorType: "admin_session",
    adminSessionId: session._id as never
  }
}

export async function insertAdminAuditEvent(
  ctx: MutationCtx,
  session: { _id: string; username: string },
  input: {
    action: string
    summary: string
    targetId: string
    targetTable: string
  }
) {
  await ctx.db.insert("auditEvents", {
    ...buildAdminAuditActor(session),
    action: input.action,
    targetTable: input.targetTable,
    targetId: input.targetId,
    summary: input.summary,
    createdAt: Date.now()
  })
}
