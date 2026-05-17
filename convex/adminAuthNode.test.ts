import { beforeEach, describe, expect, it, vi } from "vitest"

import { signInWithPassword } from "./adminAuthNode"

const { argon2Verify } = vi.hoisted(() => ({
  argon2Verify: vi.fn()
}))

vi.mock("hash-wasm", () => ({
  argon2Verify
}))

const signInWithPasswordHandler = signInWithPassword as typeof signInWithPassword & {
  _handler: (ctx: unknown, args: { password: string; username: string }) => Promise<unknown>
}

describe("signInWithPassword", () => {
  beforeEach(() => {
    argon2Verify.mockReset()
    argon2Verify.mockResolvedValue(false)
    process.env.ADMIN_USERNAME = "admin"
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$fake$fake"
  })

  it("rate limits failed sign-ins even when attackers rotate unknown usernames", async () => {
    const attempts: Array<{ createdAt: number; successful: boolean; username: string }> = []
    const ctx = {
      runMutation: vi.fn(async (_reference, args: { successful: boolean; username: string }) => {
        attempts.push({
          createdAt: Date.now(),
          successful: args.successful,
          username: args.username
        })
      }),
      runQuery: vi.fn(async (_reference, args: { username: string; windowStart: number }) => {
        return attempts.filter((attempt) => attempt.username === args.username && attempt.createdAt >= args.windowStart)
      })
    }

    for (let index = 0; index < 5; index += 1) {
      await expect(
        signInWithPasswordHandler._handler(ctx as never, {
          password: "wrong-password",
          username: `unknown-${index}`
        })
      ).rejects.toThrow("Invalid admin credentials")
    }

    await expect(
      signInWithPasswordHandler._handler(ctx as never, {
        password: "wrong-password",
        username: "unknown-5"
      })
    ).rejects.toThrow("Too many login attempts. Please try again later.")
  })
})
