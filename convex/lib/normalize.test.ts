import { describe, expect, it } from "vitest"

import { buildCitationLabel, normalizeParsedPages } from "./normalize"

describe("normalizeParsedPages", () => {
  it("keeps markdown tables as table chunks", () => {
    const result = normalizeParsedPages([
      {
        markdown: "## LED status\n\n| LED | Meaning |\n| --- | --- |\n| OK red | Hardware fault |",
        pageNumber: 45,
        printedPageNumber: "45"
      }
    ])

    expect(result.chunks.map((chunk) => chunk.chunkType)).toEqual(["text", "table"])
  })

  it("flags image-placeholder pages for OCR fallback", () => {
    const result = normalizeParsedPages([
      {
        markdown: "![img-0.jpeg](img-0.jpeg)",
        pageNumber: 9,
        printedPageNumber: "9"
      }
    ])

    expect(result.pages[0]?.needsOcrFallback).toBe(true)
  })

  it("uses the printed page number in citation labels when available", () => {
    expect(buildCitationLabel(12, "A-3")).toBe("Page A-3")
    expect(buildCitationLabel(12)).toBe("Page 12")
  })
})
