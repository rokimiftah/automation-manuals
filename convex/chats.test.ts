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
        title: "PowerFlex 755 startup"
      })
    )
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
})
