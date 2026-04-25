import { beforeEach, describe, expect, it, vi } from "vitest"

import { ensureSession, getSession, listMessages } from "./chats"

const ensureSessionHandler = ensureSession as typeof ensureSession & {
  _handler: (ctx: unknown, args: { title: string }) => Promise<{ sessionAccessToken: string; sessionId: never }>
}

const getSessionHandler = getSession as typeof getSession & {
  _handler: (
    ctx: unknown,
    args: { sessionAccessToken: string; sessionId: never }
  ) => Promise<null | { _id: never; createdAt: number; title: string; updatedAt: number }>
}

const listMessagesHandler = listMessages as typeof listMessages & {
  _handler: (
    ctx: unknown,
    args: { sessionAccessToken: string; sessionId: never }
  ) => Promise<Array<{ _id: never; content: string; role: "user" | "assistant" }>>
}

describe("chats access boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("creates a session with a new opaque access token", async () => {
    const insert = vi.fn().mockResolvedValue("chatSessions_1")

    const result = await ensureSessionHandler._handler(
      {
        db: { insert }
      } as never,
      { title: "PowerFlex 755 startup" }
    )

    expect(result.sessionId).toBe("chatSessions_1")
    expect(result.sessionAccessToken).toEqual(expect.any(String))
    expect(result.sessionAccessToken.length).toBeGreaterThan(10)
    expect(insert).toHaveBeenCalledWith(
      "chatSessions",
      expect.objectContaining({
        accessTokenHash: expect.any(String),
        expiresAt: expect.any(Number),
        title: "PowerFlex 755 startup"
      })
    )
  })

  it("does not reveal a session when the bearer token has expired", async () => {
    const accessTokenHash = "f".repeat(64)
    const session = {
      _id: "chatSessions_1" as never,
      accessTokenHash,
      createdAt: 1,
      expiresAt: Date.now() - 1,
      revokedAt: undefined,
      title: "PowerFlex 755 startup",
      updatedAt: 2
    }

    const _digestSpy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockResolvedValue(Uint8Array.from({ length: 32 }, () => 0xff).buffer)

    const result = await getSessionHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue(session)
        }
      } as never,
      {
        sessionAccessToken: "expired-token",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(result).toBeNull()
  })

  it("does not reveal a session when the access token is wrong", async () => {
    const session = {
      _id: "chatSessions_1" as never,
      accessTokenHash: "some-other-hash",
      createdAt: 1,
      title: "PowerFlex 755 startup",
      updatedAt: 2
    }

    const result = await getSessionHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue(session)
        }
      } as never,
      {
        sessionAccessToken: "wrong-token",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(result).toBeNull()
  })

  it("does not reveal messages when the access token is wrong", async () => {
    const session = {
      _id: "chatSessions_1" as never,
      accessTokenHash: "some-other-hash",
      createdAt: 1,
      title: "PowerFlex 755 startup",
      updatedAt: 2
    }

    const result = await listMessagesHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue(session),
          query: vi.fn()
        }
      } as never,
      {
        sessionAccessToken: "wrong-token",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(result).toEqual([])
  })

  it("does not reveal messages when the session was revoked", async () => {
    const accessTokenHash = "f".repeat(64)
    const _digestSpy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockResolvedValue(Uint8Array.from({ length: 32 }, () => 0xff).buffer)

    const result = await listMessagesHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue({
            _id: "chatSessions_1" as never,
            accessTokenHash,
            createdAt: 1,
            expiresAt: Date.now() + 60_000,
            revokedAt: Date.now(),
            title: "PowerFlex 755 startup",
            updatedAt: 2
          }),
          query: vi.fn()
        }
      } as never,
      {
        sessionAccessToken: "revoked-token",
        sessionId: "chatSessions_1" as never
      }
    )

    expect(result).toEqual([])
  })
})
