import { describe, expect, it } from "vitest"

import { buildCitationLabel, normalizeParsedPages } from "./normalize"
import { normalizeMineruDocument } from "./mineruResult"

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

  it("drops image-only markdown blocks from embedding chunks", () => {
    const result = normalizeParsedPages([
      {
        markdown: "![img-0.jpeg](img-0.jpeg)",
        pageNumber: 9,
        printedPageNumber: "9"
      }
    ])

    expect(result.pages[0]?.needsOcrFallback).toBe(true)
    expect(result.chunks).toEqual([])
  })

  it("treats html tables as table chunks", () => {
    const result = normalizeParsedPages([
      {
        markdown: "# Important User Information\n\n<table><tr><td>IMPORTANT</td></tr></table>",
        pageNumber: 2,
        printedPageNumber: "2"
      }
    ])

    expect(result.chunks.map((chunk) => chunk.chunkType)).toEqual(["text", "table"])
  })

  it("uses the printed page number in citation labels when available", () => {
    expect(buildCitationLabel(12, "A-3")).toBe("Page A-3")
    expect(buildCitationLabel(12)).toBe("Page 12")
  })
})

describe("normalizeMineruDocument", () => {
  it("converts MinerU pages into page-local markdown and structured chunks", () => {
    const result = normalizeMineruDocument({
      pdf_info: [
        {
          discarded_blocks: [],
          page_idx: 1,
          page_size: [612, 792],
          para_blocks: [
            {
              bbox: [0, 0, 0, 0],
              lines: [{ bbox: [0, 0, 0, 0], spans: [{ bbox: [0, 0, 0, 0], content: "Important User Information", type: "text" }] }],
              type: "title"
            },
            {
              bbox: [0, 0, 0, 0],
              lines: [{ bbox: [0, 0, 0, 0], spans: [{ bbox: [0, 0, 0, 0], content: "Read this document before installation.", type: "text" }] }],
              type: "text"
            },
            {
              bbox: [0, 0, 0, 0],
              blocks: [
                {
                  bbox: [0, 0, 0, 0],
                  lines: [
                    {
                      bbox: [0, 0, 0, 0],
                      spans: [{ bbox: [0, 0, 0, 0], html: "<table><tr><td>IMPORTANT</td></tr></table>", type: "table" }]
                    }
                  ],
                  type: "table_body"
                }
              ],
              type: "table"
            }
          ]
        }
      ]
    })

    expect(result.pages[0]?.pageNumber).toBe(2)
    expect(result.pages[0]?.markdown).toContain("# Important User Information")
    expect(result.pages[0]?.markdown).toContain("Read this document before installation.")
    expect(result.pages[0]?.markdown).toContain("<table><tr><td>IMPORTANT</td></tr></table>")
    expect(result.chunks.some((chunk) => chunk.chunkType === "table")).toBe(true)
  })
})
