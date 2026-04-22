import { describe, expect, it, vi } from "vitest"

import { buildDocumentPayload } from "./ingestDocument"

describe("buildDocumentPayload", () => {
  it("runs OCR only for pages that need fallback and embeds the final chunks", async () => {
    const parse = vi.fn().mockResolvedValue([
      {
        markdown: "![img-0.jpeg](img-0.jpeg)",
        pageNumber: 1,
        printedPageNumber: "1"
      },
      {
        markdown: "Connect the chassis cable before powering the device to avoid damage and ensure stable operation.",
        pageNumber: 2,
        printedPageNumber: "2"
      }
    ])
    const ocr = vi.fn().mockResolvedValue("Replace the damaged connector.")
    const embed = vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4]
    ])

    const result = await buildDocumentPayload({
      embed,
      ocr,
      parse,
      sourceUrl: "https://vendor.example/manual.pdf"
    })

    expect(parse).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledWith("https://vendor.example/manual.pdf", 1)
    expect(embed).toHaveBeenCalledWith([
      "Replace the damaged connector.",
      "Connect the chassis cable before powering the device to avoid damage and ensure stable operation."
    ])
    expect(result.chunks).toHaveLength(2)
    expect(result.embeddings).toHaveLength(result.chunks.length)
  })

  it("rejects mismatched embeddings", async () => {
    const parse = vi.fn().mockResolvedValue([
      {
        markdown: "Install controller and verify the chassis cable before powering the device to avoid damage and unsafe startup conditions.",
        pageNumber: 2
      }
    ])
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]])

    await expect(
      buildDocumentPayload({
        embed,
        ocr: vi.fn().mockResolvedValue("Replace the damaged connector."),
        parse,
        sourceUrl: "https://vendor.example/manual.pdf"
      })
    ).rejects.toThrow("Embedding count does not match chunk count")
  })
})
