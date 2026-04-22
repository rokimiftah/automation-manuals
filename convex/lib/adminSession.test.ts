import { describe, expect, it, vi } from "vitest"

import {
  authenticateAdminLogin,
  buildAdminAuditActor,
  getAdminAuthEnv,
  getRateLimitState,
  hashSessionToken,
  isSessionStateValid
} from "./adminSession"

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

  it("throws when ADMIN_USERNAME is missing", () => {
    expect(() =>
      getAdminAuthEnv({ ADMIN_PASSWORD_HASH: "hash", ADMIN_SESSION_TTL_MS: "1800000" })
    ).toThrow("ADMIN_USERNAME is required")
  })

  it("throws when ADMIN_SESSION_TTL_MS is invalid", () => {
    expect(() =>
      getAdminAuthEnv({
        ADMIN_PASSWORD_HASH: "hash",
        ADMIN_USERNAME: "admin",
        ADMIN_SESSION_TTL_MS: "-100"
      })
    ).toThrow("ADMIN_SESSION_TTL_MS must be a positive integer")
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

  it("produces consistent hashes for the same input", async () => {
    const hash1 = await hashSessionToken("test-token")
    const hash2 = await hashSessionToken("test-token")
    expect(hash1).toBe(hash2)
  })
})

describe("isSessionStateValid", () => {
  it("rejects revoked or expired sessions", () => {
    expect(isSessionStateValid({ expiresAt: 1_000, now: 1_000, revokedAt: undefined })).toBe(false)
    expect(isSessionStateValid({ expiresAt: 2_000, now: 1_000, revokedAt: 500 })).toBe(false)
    expect(isSessionStateValid({ expiresAt: 2_000, now: 1_000, revokedAt: undefined })).toBe(true)
  })
})

describe("buildAdminAuditActor", () => {
  it("maps an admin session to stable audit metadata", () => {
    expect(buildAdminAuditActor({ _id: "adminSessions_7" as never, username: "root" })).toEqual({
      actorLabel: "root",
      actorType: "admin_session",
      adminSessionId: "adminSessions_7"
    })
  })
})