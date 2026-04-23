// @vitest-environment node

import { execFileSync } from "node:child_process"
import path from "node:path"

import { argon2Verify } from "hash-wasm"
import { describe, expect, it } from "vitest"

const scriptPath = path.resolve(process.cwd(), "scripts/hash-admin-password.mjs")

function hashPassword(password: string) {
  return execFileSync(process.execPath, [scriptPath, password], {
    encoding: "utf8"
  }).trim()
}

describe("hash-admin-password script", () => {
  it("generates a unique hash on repeated runs for the same password", () => {
    const firstHash = hashPassword("CorrectHorseBatteryStaple!")
    const secondHash = hashPassword("CorrectHorseBatteryStaple!")

    expect(firstHash).not.toBe(secondHash)
  })

  it("produces an encoded hash that verifies the password", async () => {
    const hash = hashPassword("GuardLogix-Admin-Password")

    await expect(
      argon2Verify({
        hash,
        password: new TextEncoder().encode("GuardLogix-Admin-Password")
      })
    ).resolves.toBe(true)
  })
})
