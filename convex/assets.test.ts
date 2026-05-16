import { describe, expect, it, vi } from "vitest"

import { resolveViewerAsset } from "./assets"

const resolveViewerAssetHandler = resolveViewerAsset as typeof resolveViewerAsset & {
  _handler: (
    ctx: {
      db: {
        get: ReturnType<typeof vi.fn>
        query: ReturnType<typeof vi.fn>
      }
      storage: {
        getUrl: ReturnType<typeof vi.fn>
      }
    },
    args: { assetId: never; citationLabel: string }
  ) => Promise<{
    _id: never
    kind: "source_pdf"
    pageNumber?: number
    url: string
  } | null>
}

describe("resolveViewerAsset", () => {
  it("uses the citation label to resolve the physical page", async () => {
    const rangeBuilder = {
      eq: vi.fn(() => rangeBuilder)
    }

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "documentAssets_1",
        documentId: "documents_1",
        isCurrent: true,
        kind: "source_pdf",
        storageId: "storage_1",
        pageNumber: undefined
      })
      .mockResolvedValueOnce({
        _id: "documents_1",
        status: "ready"
      })

    const collect = vi.fn().mockResolvedValue([
      { pageNumber: 1, printedPageNumber: undefined },
      { pageNumber: 12, printedPageNumber: "A-3" },
      { pageNumber: 13, printedPageNumber: "A-4" }
    ])

    const withIndex = vi.fn((_indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
      rangeBuilderFn(rangeBuilder)
      return { collect }
    })
    const query = vi.fn(() => ({ withIndex }))
    const getUrl = vi.fn().mockResolvedValue("https://storage.example/manual.pdf")

    const result = await resolveViewerAssetHandler._handler(
      {
        db: { get, query },
        storage: { getUrl }
      },
      {
        assetId: "documentAssets_1" as never,
        citationLabel: "Page A-3"
      }
    )

    expect(result).toEqual({
      _id: "documentAssets_1",
      kind: "source_pdf",
      pageNumber: 12,
      url: "https://storage.example/manual.pdf"
    })
    expect(query).toHaveBeenCalledWith("documentPages")
    expect(rangeBuilder.eq).toHaveBeenNthCalledWith(1, "documentId", "documents_1")
    expect(rangeBuilder.eq).toHaveBeenNthCalledWith(2, "isCurrent", true)
    expect(getUrl).toHaveBeenCalledWith("storage_1")
  })
})
