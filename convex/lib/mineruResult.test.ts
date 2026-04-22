import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { normalizeMineruDocument } from "./mineruResult"

describe("normalizeMineruDocument fixture", () => {
  it("drops discarded headers and keeps table html from the provided MinerU sample", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../mineru_example.json", import.meta.url), "utf8"))

    const result = normalizeMineruDocument(fixture)

    expect(result.pages[0]?.markdown).toContain("# GuardLogix 5570 Controllers")
    expect(result.pages[0]?.markdown).not.toContain("User Manual")
    expect(result.chunks.some((chunk) => chunk.content.includes("<table>"))).toBe(true)
  })
})
