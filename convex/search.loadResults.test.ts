import { describe, expect, it, vi } from "vitest"

import { loadSearchResults } from "./search"

const loadSearchResultsHandler = loadSearchResults as typeof loadSearchResults & {
  _handler: (
    ctx: unknown,
    args: {
      matches: Array<{ _id: never; _score: number }>
      scope?: { productSlug?: string; vendorSlug?: string }
    }
  ) => Promise<
    Array<{
      assetId?: never
      citationLabel: string
      chunkId: never
      content: string
      pageNumber: number
      score: number
    }>
  >
}

describe("loadSearchResults", () => {
  it("includes ready documents", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        chunkId: "chunks_1" as never,
        documentId: "documents_1" as never,
        isCurrent: true
      })
      .mockResolvedValueOnce({
        _id: "chunks_1" as never,
        citationLabel: "Page 12",
        content: "Rockwell Automation manual excerpt.",
        isCurrent: true,
        pageNumber: 12
      })
      .mockResolvedValueOnce({
        sourceAssetId: "documentAssets_1" as never,
        status: "ready"
      })

    const results = await loadSearchResultsHandler._handler(
      {
        db: { get }
      } as never,
      {
        matches: [{ _id: "chunkEmbeddings_1" as never, _score: 0.91 }]
      }
    )

    expect(results).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 12",
        chunkId: "chunks_1",
        content: "Rockwell Automation manual excerpt.",
        pageNumber: 12,
        score: 0.91
      }
    ])
  })

  it("filters loaded vector results by vendor and product scope", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        chunkId: "chunks_1" as never,
        documentId: "documents_1" as never,
        isCurrent: true
      })
      .mockResolvedValueOnce({
        _id: "chunks_1" as never,
        citationLabel: "Page 7",
        content: "PowerFlex fault text.",
        isCurrent: true,
        pageNumber: 7
      })
      .mockResolvedValueOnce({
        productSlug: "powerflex-755",
        sourceAssetId: "documentAssets_1" as never,
        status: "ready",
        vendorSlug: "rockwell-automation"
      })
      .mockResolvedValueOnce({
        chunkId: "chunks_2" as never,
        documentId: "documents_2" as never,
        isCurrent: true
      })
      .mockResolvedValueOnce({
        _id: "chunks_2" as never,
        citationLabel: "Page 12",
        content: "SINAMICS fault text.",
        isCurrent: true,
        pageNumber: 12
      })
      .mockResolvedValueOnce({
        productSlug: "sinamics-g120",
        sourceAssetId: "documentAssets_2" as never,
        status: "ready",
        vendorSlug: "siemens"
      })

    const results = await loadSearchResultsHandler._handler(
      {
        db: { get }
      } as never,
      {
        matches: [
          { _id: "chunkEmbeddings_1" as never, _score: 0.97 },
          { _id: "chunkEmbeddings_2" as never, _score: 0.95 }
        ],
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        }
      }
    )

    expect(results).toEqual([
      {
        assetId: "documentAssets_2",
        citationLabel: "Page 12",
        chunkId: "chunks_2",
        content: "SINAMICS fault text.",
        pageNumber: 12,
        score: 0.95
      }
    ])
  })
})
