import { describe, expect, it } from "vitest"

describe("documents module api", () => {
  it("does not export the legacy activation mutation", async () => {
    const module = await import("./documents")

    expect("setActive" in module).toBe(false)
  })
})
