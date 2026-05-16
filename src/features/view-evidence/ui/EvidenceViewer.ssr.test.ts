// @vitest-environment node

import { describe, expect, it } from "vitest"

describe("EvidenceViewer SSR safety", () => {
  it("can be imported without browser-only globals", async () => {
    const module = await import("./EvidenceViewer")

    expect(module.default).toBeTypeOf("function")
  })
})
