import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { normalizeMineruDocument } from "./mineruResult"

describe("normalizeMineruDocument fixture", () => {
  it("drops discarded headers and keeps table html from the provided MinerU sample", () => {
    const testPath = expect.getState().testPath
    if (!testPath) {
      throw new Error("Vitest testPath is unavailable")
    }

    const testDir = dirname(testPath)
    const fixture = JSON.parse(readFileSync(resolve(testDir, "__fixtures__/mineru_guardlogix_middle.json"), "utf8"))

    const result = normalizeMineruDocument(fixture)

    expect(result.pages[0]?.markdown).toContain("# GuardLogix 5570 Controllers")
    expect(result.pages[0]?.markdown).not.toContain("User Manual")
    expect(result.chunks.some((chunk) => chunk.content.includes("<table>"))).toBe(true)
  })
})
