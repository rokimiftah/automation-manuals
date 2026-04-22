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
})
