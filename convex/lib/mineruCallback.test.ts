import { describe, expect, it } from "vitest"

import { verifyMineruChecksum } from "./mineruCallback"

describe("verifyMineruChecksum", () => {
  it("accepts a valid callback checksum", async () => {
    const uid = "user-1"
    const seed = "seed-1"
    const content = JSON.stringify({ batch_id: "batch-1" })
    const checksum = await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(`${uid}${seed}${content}`))
      .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""))

    await expect(verifyMineruChecksum({ checksum, content, seed, uid })).resolves.toBe(true)
  })

  it("rejects an invalid callback checksum", async () => {
    await expect(
      verifyMineruChecksum({
        checksum: "bad-checksum",
        content: JSON.stringify({ batch_id: "batch-1" }),
        seed: "seed-1",
        uid: "user-1"
      })
    ).resolves.toBe(false)
  })
})
