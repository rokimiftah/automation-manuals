import { describe, expect, it, vi } from "vitest"

import { buildDocumentPayload } from "./ingestDocument"

describe("buildDocumentPayload", () => {
  it("accepts already-normalized provider pages and embeds only searchable chunks", async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]])

    const result = await buildDocumentPayload({
      embed,
      parsedPages: [
        {
          markdown:
            "# Install controller\n\nConnect the chassis cable before powering the device to avoid damage and ensure stable operation.\n\n![image](https://cdn.example/diagram.jpg)",
          pageNumber: 2,
          printedPageNumber: "2"
        }
      ]
    })

    expect(embed).toHaveBeenCalledWith([
      "# Install controller\n\nConnect the chassis cable before powering the device to avoid damage and ensure stable operation."
    ])
    expect(result.chunks).toHaveLength(1)
    expect(result.embeddings).toHaveLength(result.chunks.length)
  })

  it("rejects mismatched embeddings", async () => {
    const embed = vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4]
    ])

    await expect(
      buildDocumentPayload({
        embed,
        parsedPages: [
          {
            markdown:
              "Install controller and verify the chassis cable before powering the device to avoid damage and unsafe startup conditions.",
            pageNumber: 2
          }
        ]
      })
    ).rejects.toThrow("Embedding count does not match chunk count")
  })

  it("runs OCR only for fallback pages in the parsed-pages branch", async () => {
    const embed = vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4]
    ])
    const ocr = vi.fn().mockResolvedValue("Recovered controller wiring instructions with enough text to be chunked safely.")

    await buildDocumentPayload({
      embed,
      ocr,
      parsedPages: [
        {
          markdown: "![image](https://cdn.example/page-1.png)",
          needsOcrFallback: true,
          pageNumber: 1
        },
        {
          markdown: "Install the module beside the controller and torque the rail screws before power-up.",
          needsOcrFallback: false,
          pageNumber: 2
        }
      ],
      sourceUrl: "https://vendor.example/manual.pdf"
    } as never)

    expect(ocr).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledWith("https://vendor.example/manual.pdf", 1)
    expect(embed).toHaveBeenCalledWith([
      "Recovered controller wiring instructions with enough text to be chunked safely.",
      "Install the module beside the controller and torque the rail screws before power-up."
    ])
  })

  it("skips OCR for non-fallback provider pages", async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]])
    const ocr = vi.fn()

    await buildDocumentPayload({
      embed,
      ocr,
      parsedPages: [
        {
          markdown: "Install the module beside the controller and torque the rail screws before power-up.",
          needsOcrFallback: false,
          pageNumber: 2
        }
      ],
      sourceUrl: "https://vendor.example/manual.pdf"
    } as never)

    expect(ocr).not.toHaveBeenCalled()
  })

  it("signals before embedding begins", async () => {
    const order: string[] = []
    const embed = vi.fn().mockImplementation(async () => {
      order.push("embed")
      return [[0.1, 0.2]]
    })
    const onBeforeEmbed = vi.fn().mockImplementation(() => {
      order.push("before")
    })

    await buildDocumentPayload({
      embed,
      onBeforeEmbed,
      parsedPages: [
        {
          markdown: "Recovered controller wiring instructions with enough text to be chunked safely.",
          pageNumber: 1
        }
      ]
    } as never)

    expect(onBeforeEmbed).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["before", "embed"])
  })
})
