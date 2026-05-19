import { describe, expect, it, vi } from "vitest"

import { extractExactSearchTerms } from "./lib/exactTerms"
import {
  GLOBAL_EXACT_MATCH_PAGE_SIZE,
  loadExactResults,
  loadGlobalExactResultsByTerms,
  loadGlobalExactResultsPage
} from "./search"

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
    args: {
      paginationOpts: { cursor: string | null; numItems: number }
      scope?: { productSlug?: string; vendorSlug?: string }
    }
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

const loadGlobalExactResultsByTermsHandler = loadGlobalExactResultsByTerms as typeof loadGlobalExactResultsByTerms & {
  _handler: (
    ctx: unknown,
    args: {
      question: string
      scope?: { productSlug?: string; vendorSlug?: string }
      terms: string[]
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

function makeDocumentScopedTermDb(args: {
  chunks: Array<Record<string, unknown>>
  document: Record<string, unknown> | null
  documentId: string
  termRowsByTerm: Record<string, Array<Record<string, unknown>>>
}) {
  const collect = vi.fn(async () => args.chunks)
  const indexCalls: string[] = []
  const get = vi.fn(async (tableNameOrId: string, maybeId?: string) => {
    const id = maybeId ?? tableNameOrId
    if (id === args.documentId) {
      return args.document
    }

    return args.chunks.find((chunk) => chunk._id === id) ?? null
  })
  const query = vi.fn((tableName: string) => ({
    withIndex(indexName: string, rangeBuilderFn: (builder: { eq: (field: string, value: unknown) => unknown }) => void) {
      const filters: Array<[string, unknown]> = []
      const rangeBuilder = {
        eq(field: string, value: unknown) {
          filters.push([field, value])
          return rangeBuilder
        }
      }
      rangeBuilderFn(rangeBuilder)
      indexCalls.push(`${tableName}:${indexName}`)

      return {
        collect,
        paginate: vi.fn(),
        take: vi.fn(async () => {
          if (tableName !== "chunkTerms" || indexName !== "by_document_and_term") {
            return []
          }

          const term = filters.find(([field]) => field === "term")?.[1]
          return args.termRowsByTerm[String(term)] ?? []
        })
      }
    }
  }))

  return { collect, get, indexCalls, query }
}

describe("loadExactResults", () => {
  it("matches a literal phrase inside a merged heading chunk", async () => {
    const mergedChunk = {
      _id: "chunks_1" as never,
      citationLabel: "Page 16",
      content:
        "# Add a User to the Sudoers List\n\nAdding a user to the sudoers list allows to perform administrative tasks without logging in as root.",
      documentId: "documents_1" as never,
      isCurrent: true,
      pageNumber: 16
    }
    const db = makeDocumentScopedTermDb({
      chunks: [mergedChunk],
      document: {
        sourceAssetId: "documentAssets_1" as never,
        status: "ready"
      },
      documentId: "documents_1",
      termRowsByTerm: {
        "add a user to the sudoers list": [
          {
            chunkId: "chunks_1" as never,
            documentId: "documents_1" as never,
            term: "add a user to the sudoers list"
          }
        ]
      }
    })

    const results = await loadExactResultsHandler._handler(
      {
        db
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
    expect(db.indexCalls).toContain("chunkTerms:by_document_and_term")
    expect(db.indexCalls).not.toContain("chunks:by_document_and_current")
    expect(db.collect).not.toHaveBeenCalled()
  })

  it("uses document term index retrieval without collecting all document chunks", async () => {
    const chunks = [
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
    ]
    const db = makeDocumentScopedTermDb({
      chunks,
      document: {
        sourceAssetId: "documentAssets_1" as never,
        status: "ready"
      },
      documentId: "documents_1",
      termRowsByTerm: {
        "install the module beside the controller": [
          {
            chunkId: "chunks_2" as never,
            documentId: "documents_1" as never,
            term: "install the module beside the controller"
          },
          {
            chunkId: "chunks_1" as never,
            documentId: "documents_1" as never,
            term: "install the module beside the controller"
          }
        ]
      }
    })

    const results = await loadExactResultsHandler._handler(
      {
        db
      } as never,
      {
        documentId: "documents_1" as never,
        exactContent: "Install the module beside the controller."
      }
    )

    expect(db.indexCalls).toContain("chunkTerms:by_document_and_term")
    expect(db.indexCalls).not.toContain("chunks:by_document_and_current")
    expect(db.collect).not.toHaveBeenCalled()
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

  it("matches compact chunk fault codes from hyphenated document-scoped queries", async () => {
    const chunk = {
      _id: "chunks_1" as never,
      citationLabel: "Page 3",
      content: "F002 overvoltage fault table.",
      documentId: "documents_1" as never,
      isCurrent: true,
      pageNumber: 3
    }
    const db = makeDocumentScopedTermDb({
      chunks: [chunk],
      document: {
        sourceAssetId: "documentAssets_1" as never,
        status: "ready"
      },
      documentId: "documents_1",
      termRowsByTerm: {
        f002: [
          {
            chunkId: "chunks_1" as never,
            documentId: "documents_1" as never,
            term: "f002"
          }
        ]
      }
    })

    const results = await loadExactResultsHandler._handler(
      {
        db
      } as never,
      {
        documentId: "documents_1" as never,
        exactContent: "Fault F-002 appeared"
      }
    )

    expect(db.indexCalls).toContain("chunkTerms:by_document_and_term")
    expect(db.collect).not.toHaveBeenCalled()
    expect(results).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 3",
        chunkId: "chunks_1",
        content: "F002 overvoltage fault table.",
        pageNumber: 3,
        score: 0.9
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

  it("filters global exact candidates by vendor and product scope", async () => {
    const db = makeDb(
      [],
      [
        [
          {
            _id: "chunks_1" as never,
            citationLabel: "Page 4",
            content: "F002 PowerFlex exact match.",
            documentId: "documents_1" as never,
            isCurrent: true,
            pageNumber: 4
          },
          {
            _id: "chunks_2" as never,
            citationLabel: "Page 9",
            content: "F002 SINAMICS exact match.",
            documentId: "documents_2" as never,
            isCurrent: true,
            pageNumber: 9
          }
        ]
      ]
    )

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        productSlug: "powerflex-755",
        sourceAssetId: "documentAssets_1" as never,
        status: "ready",
        vendorSlug: "rockwell-automation"
      })
      .mockResolvedValueOnce({
        productSlug: "sinamics-g120",
        sourceAssetId: "documentAssets_2" as never,
        status: "ready",
        vendorSlug: "siemens"
      })

    const results = await loadGlobalExactResultsPageHandler._handler(
      {
        db: { ...db, get }
      } as never,
      {
        paginationOpts: {
          cursor: null,
          numItems: GLOBAL_EXACT_MATCH_PAGE_SIZE
        },
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        }
      }
    )

    expect(results.page).toEqual([
      {
        assetId: "documentAssets_2",
        citationLabel: "Page 9",
        chunkId: "chunks_2",
        content: "F002 SINAMICS exact match.",
        pageNumber: 9
      }
    ])
  })
})

describe("loadGlobalExactResultsByTerms", () => {
  it("keeps strong exact term matches for narrative diagnostic questions", async () => {
    const termRows = [
      {
        chunkId: "chunks_1" as never,
        documentId: "documents_1" as never,
        term: "f002"
      }
    ]
    const chunk = {
      _id: "chunks_1" as never,
      citationLabel: "Page 3",
      content: "F002 overvoltage fault table.",
      documentId: "documents_1" as never,
      isCurrent: true,
      pageNumber: 3
    }
    const document = {
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    }
    const rangeBuilder = {
      eq: vi.fn(() => rangeBuilder)
    }
    const take = vi.fn(async () => termRows)
    const withIndex = vi.fn((indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
      rangeBuilderFn(rangeBuilder)
      expect(indexName).toBe("by_term")
      return { take }
    })
    const get = vi.fn(async (id: string) => {
      if (id === "chunks_1") {
        return chunk
      }
      if (id === "documents_1") {
        return document
      }
      return null
    })
    const query = vi.fn(() => ({ withIndex }))

    const results = await loadGlobalExactResultsByTermsHandler._handler(
      {
        db: { get, query }
      } as never,
      {
        question: "What should I check for F002 after first power on?",
        terms: ["f002"]
      }
    )

    expect(rangeBuilder.eq).toHaveBeenCalledWith("term", "f002")
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(
      expect.objectContaining({
        assetId: "documentAssets_1",
        citationLabel: "Page 3",
        chunkId: "chunks_1",
        content: "F002 overvoltage fault table.",
        pageNumber: 3
      })
    )
  })

  it("does not keep candidates matched only by weak common terms", async () => {
    const termRows = [
      {
        chunkId: "chunks_weak" as never,
        documentId: "documents_1" as never,
        term: "what"
      }
    ]
    const chunk = {
      _id: "chunks_weak" as never,
      citationLabel: "Page 5",
      content: "What unrelated overview table.",
      documentId: "documents_1" as never,
      isCurrent: true,
      pageNumber: 5
    }
    const document = {
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    }
    const rangeBuilder = {
      eq: vi.fn(() => rangeBuilder)
    }
    const take = vi.fn(async () => termRows)
    const withIndex = vi.fn((_indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
      rangeBuilderFn(rangeBuilder)
      return { take }
    })
    const get = vi.fn(async (id: string) => {
      if (id === "chunks_weak") {
        return chunk
      }
      if (id === "documents_1") {
        return document
      }
      return null
    })
    const query = vi.fn(() => ({ withIndex }))

    const results = await loadGlobalExactResultsByTermsHandler._handler(
      {
        db: { get, query }
      } as never,
      {
        question: "What should I check after first power on?",
        terms: ["what"]
      }
    )

    expect(results).toEqual([])
  })

  it("filters term exact candidates by vendor and product scope", async () => {
    const documents = [
      {
        _id: "documents_1" as never,
        language: "English",
        productSlug: "powerflex-755",
        sourceAssetId: "documentAssets_1" as never,
        status: "ready",
        title: "PowerFlex 755 Manual",
        vendorSlug: "rockwell-automation",
        version: "v1"
      },
      {
        _id: "documents_2" as never,
        language: "English",
        productSlug: "sinamics-g120",
        sourceAssetId: "documentAssets_2" as never,
        status: "ready",
        title: "SINAMICS G120 Operating Instructions",
        vendorSlug: "siemens",
        version: "v1"
      }
    ]
    const chunks = new Map<string, Record<string, unknown>>([
      [
        "chunks_1",
        {
          _id: "chunks_1" as never,
          citationLabel: "Page 4",
          content: "F002 exact match PowerFlex.",
          documentId: "documents_1" as never,
          isCurrent: true,
          pageNumber: 4
        }
      ],
      [
        "chunks_2",
        {
          _id: "chunks_2" as never,
          citationLabel: "Page 9",
          content: "F002 exact match SINAMICS.",
          documentId: "documents_2" as never,
          isCurrent: true,
          pageNumber: 9
        }
      ]
    ])

    const get = vi.fn(async (id: string) => chunks.get(id) ?? null)
    const query = vi.fn((tableName: string) => ({
      withIndex(indexName: string, rangeBuilderFn: (builder: { eq: (field: string, value: unknown) => unknown }) => void) {
        const filters: Array<[string, unknown]> = []
        const rangeBuilder = {
          eq(field: string, value: unknown) {
            filters.push([field, value])
            return rangeBuilder
          }
        }
        rangeBuilderFn(rangeBuilder)

        return {
          collect: vi.fn(async () => []),
          take: vi.fn(async () => {
            if (
              tableName === "documents" &&
              indexName === "by_status_vendor_product" &&
              filters.some(([field, value]) => field === "status" && value === "ready") &&
              filters.some(([field, value]) => field === "vendorSlug" && value === "siemens") &&
              filters.some(([field, value]) => field === "productSlug" && value === "sinamics-g120")
            ) {
              return [documents[1]]
            }

            if (
              tableName === "chunkTerms" &&
              indexName === "by_document_and_term" &&
              filters.some(([field, value]) => field === "documentId" && value === "documents_2") &&
              filters.some(([field, value]) => field === "term" && value === "f002")
            ) {
              return [
                {
                  chunkId: "chunks_2" as never,
                  documentId: "documents_2" as never,
                  term: "f002"
                }
              ]
            }

            return []
          })
        }
      }
    }))

    const results = await loadGlobalExactResultsByTermsHandler._handler(
      {
        db: { get, query }
      } as never,
      {
        question: "F002 exact match",
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        },
        terms: ["f002"]
      }
    )

    expect(results).toEqual([
      {
        assetId: "documentAssets_2",
        citationLabel: "Page 9",
        chunkId: "chunks_2",
        content: "F002 exact match SINAMICS.",
        pageNumber: 9,
        score: 1
      }
    ])
  })

  it("returns unscoped exact term matches from the term index", async () => {
    const termRows = [
      {
        chunkId: "chunks_2" as never,
        documentId: "documents_1" as never,
        term: "f002"
      },
      {
        chunkId: "chunks_1" as never,
        documentId: "documents_1" as never,
        term: "f002"
      }
    ]
    const chunks = new Map<string, Record<string, unknown>>([
      [
        "chunks_1",
        {
          _id: "chunks_1" as never,
          citationLabel: "Page 2",
          content: "F002 exact match reset instructions.",
          documentId: "documents_1" as never,
          isCurrent: true,
          pageNumber: 2
        }
      ],
      [
        "chunks_2",
        {
          _id: "chunks_2" as never,
          citationLabel: "Page 8",
          content: "F002 exact match reset instructions.",
          documentId: "documents_1" as never,
          isCurrent: true,
          pageNumber: 8
        }
      ]
    ])
    const document = {
      productSlug: "sinamics-g120",
      sourceAssetId: "documentAssets_1" as never,
      status: "ready",
      vendorSlug: "siemens"
    }
    const indexCalls: string[] = []
    const rangeBuilder = {
      eq: vi.fn(() => rangeBuilder)
    }
    const take = vi.fn(async () => termRows)
    const withIndex = vi.fn((indexName: string, rangeBuilderFn: (builder: typeof rangeBuilder) => void) => {
      rangeBuilderFn(rangeBuilder)
      indexCalls.push(`chunkTerms:${indexName}`)
      return { take }
    })
    const get = vi.fn(async (id: string) => chunks.get(id) ?? (id === "documents_1" ? document : null))
    const query = vi.fn(() => ({ withIndex }))

    const results = await loadGlobalExactResultsByTermsHandler._handler(
      {
        db: { get, query }
      } as never,
      {
        question: "F002 exact match",
        terms: ["f002"]
      }
    )

    expect(indexCalls).toEqual(["chunkTerms:by_term"])
    expect(rangeBuilder.eq).toHaveBeenCalledWith("term", "f002")
    expect(results).toEqual([
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 2",
        chunkId: "chunks_1",
        content: "F002 exact match reset instructions.",
        pageNumber: 2,
        score: 1
      },
      {
        assetId: "documentAssets_1",
        citationLabel: "Page 8",
        chunkId: "chunks_2",
        content: "F002 exact match reset instructions.",
        pageNumber: 8,
        score: 1
      }
    ])
  })

  it("finds scoped term matches after out-of-scope by_term rows", async () => {
    const outOfScopeTermRows = Array.from({ length: 64 }, (_, index) => ({
      chunkId: `chunks_out_${index + 1}` as never,
      documentId: "documents_1" as never,
      term: "f002"
    }))
    const scopedTermRow = {
      chunkId: "chunks_2" as never,
      documentId: "documents_2" as never,
      term: "f002"
    }
    const documents = new Map<string, Record<string, unknown>>([
      [
        "documents_1",
        {
          _id: "documents_1" as never,
          language: "English",
          productSlug: "powerflex-755",
          sourceAssetId: "documentAssets_1" as never,
          status: "ready",
          title: "PowerFlex 755 Manual",
          vendorSlug: "rockwell-automation",
          version: "v1"
        }
      ],
      [
        "documents_2",
        {
          _id: "documents_2" as never,
          language: "English",
          productSlug: "sinamics-g120",
          sourceAssetId: "documentAssets_2" as never,
          status: "ready",
          title: "SINAMICS G120 Operating Instructions",
          vendorSlug: "siemens",
          version: "v1"
        }
      ]
    ])
    const chunks = new Map<string, Record<string, unknown>>([
      ...outOfScopeTermRows.map(
        (row, index) =>
          [
            String(row.chunkId),
            {
              _id: row.chunkId,
              citationLabel: `Page ${index + 1}`,
              content: "F002 exact match PowerFlex.",
              documentId: "documents_1" as never,
              isCurrent: true,
              pageNumber: index + 1
            }
          ] as const
      ),
      [
        "chunks_2",
        {
          _id: "chunks_2" as never,
          citationLabel: "Page 9",
          content: "F002 exact match SINAMICS.",
          documentId: "documents_2" as never,
          isCurrent: true,
          pageNumber: 9
        }
      ]
    ])
    const indexCalls: string[] = []

    const get = vi.fn(async (id: string) => chunks.get(id) ?? documents.get(id) ?? null)
    const query = vi.fn((tableName: string) => ({
      withIndex(indexName: string, rangeBuilderFn: (builder: { eq: (field: string, value: unknown) => unknown }) => void) {
        const filters: Array<[string, unknown]> = []
        const rangeBuilder = {
          eq(field: string, value: unknown) {
            filters.push([field, value])
            return rangeBuilder
          }
        }
        rangeBuilderFn(rangeBuilder)
        indexCalls.push(`${tableName}:${indexName}`)

        return {
          collect: vi.fn(async () => {
            return []
          }),
          take: vi.fn(async () => {
            if (
              tableName === "documents" &&
              indexName === "by_status_vendor_product" &&
              filters.some(([field, value]) => field === "status" && value === "ready") &&
              filters.some(([field, value]) => field === "vendorSlug" && value === "siemens") &&
              filters.some(([field, value]) => field === "productSlug" && value === "sinamics-g120")
            ) {
              return [documents.get("documents_2")]
            }

            if (
              tableName === "chunkTerms" &&
              indexName === "by_document_and_term" &&
              filters.some(([field, value]) => field === "documentId" && value === "documents_2") &&
              filters.some(([field, value]) => field === "term" && value === "f002")
            ) {
              return [scopedTermRow]
            }

            return []
          })
        }
      }
    }))

    const results = await loadGlobalExactResultsByTermsHandler._handler(
      {
        db: { get, query }
      } as never,
      {
        question: "F002 exact match",
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        },
        terms: ["f002"]
      }
    )

    expect(indexCalls).toContain("documents:by_status_vendor_product")
    expect(indexCalls).not.toContain("documents:by_status")
    expect(indexCalls).toContain("chunkTerms:by_document_and_term")
    expect(results).toEqual([
      {
        assetId: "documentAssets_2",
        citationLabel: "Page 9",
        chunkId: "chunks_2",
        content: "F002 exact match SINAMICS.",
        pageNumber: 9,
        score: 1
      }
    ])
  })

  it("keeps fault code candidates when scoped model identifier rows crowd the batch", async () => {
    const document = {
      _id: "documents_1" as never,
      language: "English",
      productSlug: "sinamics-g120",
      sourceAssetId: "documentAssets_1" as never,
      status: "ready",
      title: "SINAMICS G120 Operating Instructions",
      vendorSlug: "siemens",
      version: "v1"
    }
    const g120Rows = Array.from({ length: 64 }, (_, index) => ({
      chunkId: `chunks_g120_${index + 1}` as never,
      documentId: "documents_1" as never,
      term: "g120"
    }))
    const f002Row = {
      chunkId: "chunks_f002" as never,
      documentId: "documents_1" as never,
      term: "f002"
    }
    const chunks = new Map<string, Record<string, unknown>>([
      ...g120Rows.map(
        (row, index) =>
          [
            String(row.chunkId),
            {
              _id: row.chunkId,
              citationLabel: `Page ${index + 1}`,
              content: "SINAMICS G120 setup parameter overview.",
              documentId: "documents_1" as never,
              isCurrent: true,
              pageNumber: index + 1
            }
          ] as const
      ),
      [
        "chunks_f002",
        {
          _id: "chunks_f002" as never,
          citationLabel: "Page 120",
          content: "F002 after first power on fault reset instructions.",
          documentId: "documents_1" as never,
          isCurrent: true,
          pageNumber: 120
        }
      ]
    ])

    const get = vi.fn(async (id: string) => chunks.get(id) ?? null)
    const query = vi.fn((tableName: string) => ({
      withIndex(indexName: string, rangeBuilderFn: (builder: { eq: (field: string, value: unknown) => unknown }) => void) {
        const filters: Array<[string, unknown]> = []
        const rangeBuilder = {
          eq(field: string, value: unknown) {
            filters.push([field, value])
            return rangeBuilder
          }
        }
        rangeBuilderFn(rangeBuilder)
        const term = filters.find(([field]) => field === "term")?.[1]

        return {
          take: vi.fn(async () => {
            if (
              tableName === "documents" &&
              indexName === "by_status_vendor_product" &&
              filters.some(([field, value]) => field === "status" && value === "ready") &&
              filters.some(([field, value]) => field === "vendorSlug" && value === "siemens") &&
              filters.some(([field, value]) => field === "productSlug" && value === "sinamics-g120")
            ) {
              return [document]
            }

            if (tableName === "chunkTerms" && indexName === "by_document_and_term" && term === "g120") {
              return g120Rows
            }

            if (tableName === "chunkTerms" && indexName === "by_document_and_term" && term === "f002") {
              return [f002Row]
            }

            return []
          })
        }
      }
    }))

    const results = await loadGlobalExactResultsByTermsHandler._handler(
      {
        db: { get, query }
      } as never,
      {
        question: "Siemens SINAMICS G120 F002 after first power on",
        scope: {
          productSlug: "sinamics-g120",
          vendorSlug: "siemens"
        },
        terms: extractExactSearchTerms("Siemens SINAMICS G120 F002 after first power on")
      }
    )

    expect(results.map((result) => result.chunkId)).toContain("chunks_f002")
  })
})
