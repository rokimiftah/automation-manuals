import { describe, expect, it } from "vitest"

import * as ingestDocument from "./ingestDocument"
import { buildNormalizedDocumentPayload } from "./ingestDocument"

describe("buildNormalizedDocumentPayload", () => {
  it("does not export the legacy embedding and OCR payload builder", () => {
    expect("buildDocumentPayload" in ingestDocument).toBe(false)
  })

  it("returns normalized pages and chunks without embedding provider access", () => {
    const result = buildNormalizedDocumentPayload([
      {
        markdown:
          "# Install controller\n\nConnect the chassis cable before powering the device to avoid damage and ensure stable operation.",
        pageNumber: 2,
        printedPageNumber: "2"
      }
    ])

    expect(result.pages).toEqual([
      expect.objectContaining({
        markdown:
          "# Install controller\n\nConnect the chassis cable before powering the device to avoid damage and ensure stable operation.",
        needsOcrFallback: false,
        pageNumber: 2,
        printedPageNumber: "2"
      })
    ])
    expect(result.chunks).toEqual([
      expect.objectContaining({
        citationLabel: "Page 2",
        content:
          "# Install controller\n\nConnect the chassis cable before powering the device to avoid damage and ensure stable operation.",
        pageNumber: 2
      })
    ])
  })
})
