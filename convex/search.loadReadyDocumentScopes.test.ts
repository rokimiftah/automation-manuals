import { describe, expect, it, vi } from "vitest"

import { loadReadyDocumentScopes } from "./search"

const loadReadyDocumentScopesHandler = loadReadyDocumentScopes as typeof loadReadyDocumentScopes & {
  _handler: (
    ctx: unknown,
    args: Record<string, never>
  ) => Promise<
    Array<{
      documentId: never
      language: string
      productSlug: string
      title: string
      vendorSlug: string
      version: string
    }>
  >
}

describe("loadReadyDocumentScopes", () => {
  it("loads ready document scopes through the status index", async () => {
    const rangeBuilder = {
      eq: vi.fn(() => rangeBuilder)
    }
    const unindexedCollect = vi.fn(async () => [
      {
        _id: "documents_1" as never,
        language: "English",
        productSlug: "sinamics-g120",
        status: "ready",
        title: "SINAMICS G120 Operating Instructions",
        vendorSlug: "siemens",
        version: "v1"
      },
      {
        _id: "documents_2" as never,
        language: "English",
        productSlug: "powerflex-755",
        status: "processing",
        title: "PowerFlex 755 Manual",
        vendorSlug: "rockwell-automation",
        version: "v2"
      }
    ])
    const indexedCollect = vi.fn(async () => [
      {
        _id: "documents_2" as never,
        language: "English",
        productSlug: "powerflex-755",
        status: "ready",
        title: "PowerFlex 755 Manual",
        vendorSlug: "rockwell-automation",
        version: "v2"
      }
    ])
    const indexedTake = vi.fn(async () => [
      {
        _id: "documents_1" as never,
        language: "English",
        productSlug: "sinamics-g120",
        status: "ready",
        title: "SINAMICS G120 Operating Instructions",
        vendorSlug: "siemens",
        version: "v1"
      }
    ])
    const withIndex = vi.fn((_indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
      rangeBuilderFn(rangeBuilder)
      return { collect: indexedCollect, take: indexedTake }
    })
    const query = vi.fn(() => ({ collect: unindexedCollect, withIndex }))

    const results = await loadReadyDocumentScopesHandler._handler(
      {
        db: { query }
      } as never,
      {}
    )

    expect(query).toHaveBeenCalledWith("documents")
    expect(withIndex).toHaveBeenCalledWith("by_status", expect.any(Function))
    expect(rangeBuilder.eq).toHaveBeenCalledWith("status", "ready")
    expect(unindexedCollect).not.toHaveBeenCalled()
    expect(indexedCollect).not.toHaveBeenCalled()
    expect(indexedTake).toHaveBeenCalledWith(expect.any(Number))
    expect(results).toEqual([
      {
        documentId: "documents_1",
        language: "English",
        productSlug: "sinamics-g120",
        title: "SINAMICS G120 Operating Instructions",
        vendorSlug: "siemens",
        version: "v1"
      }
    ])
  })
})
