import { describe, expect, it, vi } from "vitest"

import { loadSearchResults } from "./search"

const loadSearchResultsHandler = loadSearchResults as typeof loadSearchResults & {
  _handler: (
    ctx: unknown,
    args: { matches: Array<{ _id: never; _score: number }> }
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
})
