import { describe, expect, it, vi } from "vitest"

import { GLOBAL_EXACT_MATCH_PAGE_SIZE, loadExactResults, loadGlobalExactResultsPage } from "./search"

const loadExactResultsHandler = loadExactResults as typeof loadExactResults & {
  _handler: (
    ctx: unknown,
    args: { documentId?: never; exactContent: string }
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

const loadGlobalExactResultsPageHandler = loadGlobalExactResultsPage as typeof loadGlobalExactResultsPage & {
  _handler: (
    ctx: unknown,
    args: { paginationOpts: { cursor: string | null; numItems: number } }
  ) => Promise<{
    continueCursor: string
    isDone: boolean
    page: Array<{
      assetId?: never
      citationLabel: string
      chunkId: never
      content: string
      pageNumber: number
    }>
  }>
}

function makeQueryResult(rows: Array<Record<string, unknown>>, pages: Array<Array<Record<string, unknown>>> = [rows]) {
  const cursorToPage = new Map<string | null, number>()
  cursorToPage.set(null, 0)

  const result = {
    collect: vi.fn(async () => rows),
    paginate: vi.fn(async ({ cursor }: { cursor: string | null }) => {
      const pageIndex = cursorToPage.get(cursor) ?? 0
      const page = pages[pageIndex] ?? []
      const nextCursor = pageIndex + 1 < pages.length ? `cursor_${pageIndex + 1}` : ""
      if (pageIndex + 1 < pages.length) {
        cursorToPage.set(nextCursor, pageIndex + 1)
      }

      return {
        continueCursor: nextCursor,
        isDone: pageIndex + 1 >= pages.length,
        page
      }
    }),
    take: vi.fn(async (limit: number) => rows.slice(0, limit))
  }

  return result
}

function makeDb(rows: Array<Record<string, unknown>>, pages: Array<Array<Record<string, unknown>>> = [rows]) {
  const rangeBuilder = {
    eq: vi.fn(() => rangeBuilder)
  }

  const queryResult = makeQueryResult(rows, pages)
  const withIndex = vi.fn((_indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
    rangeBuilderFn(rangeBuilder)
    return queryResult
  })

  const query = vi.fn(() => ({ withIndex }))

  return { query, withIndex, rangeBuilder, queryResult }
}

describe("loadExactResults", () => {
  it("matches a literal phrase inside a merged heading chunk", async () => {
    const rangeBuilder = {
      eq(field: string, value: unknown) {
        filters.push([field, value])
        return rangeBuilder
      }
    }
    const filters: Array<[string, unknown]> = []
    const collect = vi.fn(async () => {
      const isDocumentCurrentQuery =
        filters.some(([field, value]) => field === "documentId" && value === "documents_1") &&
        filters.some(([field, value]) => field === "isCurrent" && value === true)

      return isDocumentCurrentQuery ? [mergedChunk] : []
    })
    const mergedChunk = {
      _id: "chunks_1" as never,
      citationLabel: "Page 16",
      content:
        "# Add a User to the Sudoers List\n\nAdding a user to the sudoers list allows to perform administrative tasks without logging in as root.",
      documentId: "documents_1" as never,
      isCurrent: true,
      pageNumber: 16
    }
    const withIndex = vi.fn((_indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
      filters.length = 0
      rangeBuilderFn(rangeBuilder)
      return {
        collect,
        paginate: vi.fn(),
        take: vi.fn()
      }
    })
    const get = vi.fn().mockResolvedValueOnce({
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    })

    const results = await loadExactResultsHandler._handler(
      {
        db: {
          get,
          query: vi.fn(() => ({ withIndex }))
        }
      } as never,
      {
        documentId: "documents_1" as never,
        exactContent: "Add a User to the Sudoers List"
      }
    )

    expect(results).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 16",
        chunkId: "chunks_1",
        content:
          "# Add a User to the Sudoers List\n\nAdding a user to the sudoers list allows to perform administrative tasks without logging in as root.",
        pageNumber: 16,
        score: 1
      }
    ])
  })

  it("returns current literal matches from a ready document", async () => {
    const db = makeDb([
      {
        _id: "chunks_2" as never,
        citationLabel: "Page 4",
        content: "Install the module beside the controller.",
        documentId: "documents_1" as never,
        isCurrent: true,
        pageNumber: 4
      },
      {
        _id: "chunks_1" as never,
        citationLabel: "Page 2",
        content: "Install the module beside the controller.",
        documentId: "documents_1" as never,
        isCurrent: true,
        pageNumber: 2
      }
    ])

    const get = vi.fn().mockResolvedValueOnce({
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    })

    const results = await loadExactResultsHandler._handler(
      {
        db: { ...db, get }
      } as never,
      {
        documentId: "documents_1" as never,
        exactContent: "Install the module beside the controller."
      }
    )

    expect(db.withIndex).toHaveBeenCalledWith("by_document_and_current", expect.any(Function))
    expect(db.rangeBuilder.eq).toHaveBeenNthCalledWith(1, "documentId", "documents_1")
    expect(db.rangeBuilder.eq).toHaveBeenNthCalledWith(2, "isCurrent", true)
    expect(results).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 2",
        chunkId: "chunks_1",
        content: "Install the module beside the controller.",
        pageNumber: 2,
        score: 1
      },
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 4",
        chunkId: "chunks_2",
        content: "Install the module beside the controller.",
        pageNumber: 4,
        score: 1
      }
    ])
  })

  it("returns no rows when the document is missing", async () => {
    const db = makeDb([])

    const get = vi.fn().mockResolvedValueOnce(null)

    const results = await loadExactResultsHandler._handler(
      {
        db: { ...db, get }
      } as never,
      {
        documentId: "documents_missing" as never,
        exactContent: "Missing document match."
      }
    )

    expect(results).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("returns no rows when the document is not ready", async () => {
    const db = makeDb([])

    const get = vi.fn().mockResolvedValueOnce({
      sourceAssetId: "documentAssets_1" as never,
      status: "processing"
    })

    const results = await loadExactResultsHandler._handler(
      {
        db: { ...db, get }
      } as never,
      {
        documentId: "documents_processing" as never,
        exactContent: "Processing document match."
      }
    )

    expect(results).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(1)
  })
})

describe("loadGlobalExactResultsPage", () => {
  it("filters out chunks whose documents are not ready", async () => {
    const db = makeDb(
      [],
      [
        [
          {
            _id: "chunks_1" as never,
            citationLabel: "Page 7",
            content: "Use the safety latch.",
            documentId: "documents_1" as never,
            isCurrent: true,
            pageNumber: 7
          },
          {
            _id: "chunks_2" as never,
            citationLabel: "Page 8",
            content: "Use the safety latch.",
            documentId: "documents_2" as never,
            isCurrent: true,
            pageNumber: 8
          }
        ]
      ]
    )

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        sourceAssetId: "documentAssets_1" as never,
        status: "ready"
      })
      .mockResolvedValueOnce({
        sourceAssetId: "documentAssets_2" as never,
        status: "processing"
      })

    const results = await loadGlobalExactResultsPageHandler._handler(
      {
        db: { ...db, get }
      } as never,
      {
        paginationOpts: {
          cursor: null,
          numItems: GLOBAL_EXACT_MATCH_PAGE_SIZE
        }
      }
    )

    expect(results).toEqual({
      continueCursor: "",
      isDone: true,
      page: [
        {
          assetId: "documentAssets_1",
          citationLabel: "Page 7",
          chunkId: "chunks_1",
          content: "Use the safety latch.",
          pageNumber: 7
        }
      ]
    })
  })

  it("runs one bounded paginated query per call", async () => {
    const db = makeDb(
      [],
      [
        Array.from({ length: GLOBAL_EXACT_MATCH_PAGE_SIZE }, (_, index) => ({
          _id: `chunks_${index + 1}` as never,
          citationLabel: `Page ${index + 1}`,
          content: "PowerFlex 755 exact page.",
          documentId: "documents_1" as never,
          isCurrent: true,
          pageNumber: index + 1
        }))
      ]
    )

    const get = vi.fn().mockResolvedValue({
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    })

    const results = await loadGlobalExactResultsPageHandler._handler(
      {
        db: { ...db, get }
      } as never,
      {
        paginationOpts: {
          cursor: "cursor_1",
          numItems: GLOBAL_EXACT_MATCH_PAGE_SIZE
        }
      }
    )

    expect(db.query).toHaveBeenCalledWith("chunks")
    expect(db.withIndex).toHaveBeenCalledWith("by_current_and_content", expect.any(Function))
    expect(db.rangeBuilder.eq).toHaveBeenNthCalledWith(1, "isCurrent", true)
    expect(db.queryResult.paginate).toHaveBeenCalledTimes(1)
    expect(db.queryResult.paginate).toHaveBeenCalledWith({ cursor: "cursor_1", numItems: GLOBAL_EXACT_MATCH_PAGE_SIZE })
    expect(results.page).toHaveLength(GLOBAL_EXACT_MATCH_PAGE_SIZE)
  })
})
