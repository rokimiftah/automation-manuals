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
    username: username.toLowerCase(),
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

export function getRateLimitState(input: {
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