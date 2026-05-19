import { describe, expect, it, vi } from "vitest"

import { backfillDocumentExactTermsBatch, backfillExactTerms } from "./search"

const backfillDocumentExactTermsBatchHandler = backfillDocumentExactTermsBatch as typeof backfillDocumentExactTermsBatch & {
  _handler: (
    ctx: unknown,
    args: { cursor?: string | null; documentId: never; jobId: never; offset?: number; phase?: "cleanup" | "backfill" }
  ) => Promise<null>
}

const backfillExactTermsHandler = backfillExactTerms as typeof backfillExactTerms & {
  _handler: (ctx: unknown, args: { sessionToken: string }) => Promise<number>
}

describe("backfillDocumentExactTermsBatch", () => {
  it("processes one chunk batch and schedules the next batch", async () => {
    const chunks = Array.from({ length: 55 }, (_, index) => ({
      _id: `chunks_${index + 1}` as never,
      citationLabel: `Page ${index + 1}`,
      content: `Install module ${index + 1} beside the controller for proper operation and grounding.`,
      documentId: "documents_1" as never,
      ingestionJobId: "ingestionJobs_1" as never,
      isCurrent: true,
      pageNumber: index + 1
    }))
    const insert = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue(undefined)
    const collect = vi.fn(() => {
      throw new Error("chunks must be read with bounded pagination")
    })
    const paginate = vi.fn().mockResolvedValue({
      continueCursor: "cursor_backfill_2",
      isDone: false,
      page: chunks.slice(0, 50)
    })

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            insert,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect,
                    paginate
                  }))
                }
              }

              if (table === "chunkTerms") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([]),
                    take: vi.fn().mockResolvedValue([])
                  }))
                }
              }

              throw new Error(`Unexpected table ${table}`)
            })
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          offset: 0,
          phase: "backfill"
        }
      )
    ).resolves.toBeNull()

    expect(insert.mock.calls.filter(([table]) => table === "chunkTerms").length).toBeGreaterThan(0)
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: "documents_1",
      jobId: "ingestionJobs_1",
      cursor: "cursor_backfill_2",
      phase: "backfill"
    })
    expect(paginate).toHaveBeenCalledWith({
      cursor: null,
      numItems: 50
    })
  })

  it("reindexes current chunks with versionless terms during document backfill", async () => {
    const existingTerms = [{ _id: "chunkTerms_old_1" as never, chunkId: "chunks_1" as never, term: "f002" }]
    const insert = vi.fn().mockResolvedValue(undefined)
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const runMutation = vi.fn().mockResolvedValue(null)
    const paginate = vi.fn().mockResolvedValue({
      continueCursor: "",
      isDone: true,
      page: [
        {
          _id: "chunks_1" as never,
          citationLabel: "Page 99",
          content: "Diagnostic table lists F002 overvoltage reset instructions.",
          documentId: "documents_1" as never,
          ingestionJobId: "ingestionJobs_1" as never,
          isCurrent: true,
          pageNumber: 99
        }
      ]
    })

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            delete: deleteRow,
            insert,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn(() => {
                      throw new Error("current chunks must be read with bounded pagination")
                    }),
                    paginate
                  }))
                }
              }

              if (table === "chunkTerms") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue(existingTerms),
                    take: vi.fn().mockResolvedValue(existingTerms.slice(0, 1))
                  }))
                }
              }

              throw new Error(`Unexpected table ${table}`)
            })
          },
          runMutation,
          scheduler: {
            runAfter: vi.fn()
          }
        } as never,
        {
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          phase: "backfill"
        }
      )
    ).resolves.toBeNull()

    const insertedTerms = insert.mock.calls
      .filter(([table]) => table === "chunkTerms")
      .map(([, value]) => value as { version?: number })

    expect(deleteRow).toHaveBeenCalledWith("chunkTerms", "chunkTerms_old_1")
    expect(insertedTerms.length).toBeGreaterThan(0)
    expect(insertedTerms.every((term) => term.version === 2)).toBe(true)
  })

  it("skips current-version terms during document backfill", async () => {
    const existingTerms = [{ _id: "chunkTerms_current_1" as never, chunkId: "chunks_1" as never, term: "f002", version: 2 }]
    const insert = vi.fn().mockResolvedValue(undefined)
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const runMutation = vi.fn().mockResolvedValue(null)
    const paginate = vi.fn().mockResolvedValue({
      continueCursor: "",
      isDone: true,
      page: [
        {
          _id: "chunks_1" as never,
          citationLabel: "Page 99",
          content: "Diagnostic table lists F002 overvoltage reset instructions.",
          documentId: "documents_1" as never,
          ingestionJobId: "ingestionJobs_1" as never,
          isCurrent: true,
          pageNumber: 99
        }
      ]
    })

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            delete: deleteRow,
            insert,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn(() => {
                      throw new Error("current chunks must be read with bounded pagination")
                    }),
                    paginate
                  }))
                }
              }

              if (table === "chunkTerms") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue(existingTerms),
                    take: vi.fn().mockResolvedValue(existingTerms.slice(0, 1))
                  }))
                }
              }

              throw new Error(`Unexpected table ${table}`)
            })
          },
          runMutation,
          scheduler: {
            runAfter: vi.fn()
          }
        } as never,
        {
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          phase: "backfill"
        }
      )
    ).resolves.toBeNull()

    expect(deleteRow).not.toHaveBeenCalled()
    expect(insert.mock.calls.some(([table]) => table === "chunkTerms")).toBe(false)
  })

  it("cleans stale chunk terms before handing off to backfill", async () => {
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue(undefined)
    const collectChunks = vi.fn(() => {
      throw new Error("stale chunks must be read with bounded pagination")
    })
    const paginateChunks = vi.fn().mockResolvedValue({
      continueCursor: "",
      isDone: true,
      page: [
        {
          _id: "chunks_old_1" as never,
          citationLabel: "Page 1",
          content: "Old instructions",
          documentId: "documents_1" as never,
          isCurrent: false,
          pageNumber: 1
        }
      ]
    })

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            delete: deleteRow,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: collectChunks,
                    paginate: paginateChunks
                  }))
                }
              }

              if (table === "chunkTerms") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([{ _id: "chunkTerms_1" as never }])
                  }))
                }
              }

              throw new Error(`Unexpected table ${table}`)
            })
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          offset: 0,
          phase: "cleanup"
        }
      )
    ).resolves.toBeNull()

    expect(deleteRow).toHaveBeenCalledWith("chunkTerms", "chunkTerms_1")
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: "documents_1",
      jobId: "ingestionJobs_1",
      cursor: null,
      phase: "backfill"
    })
    expect(paginateChunks).toHaveBeenCalledWith({
      cursor: null,
      numItems: 50
    })
  })

  it("continues cleanup from the returned cursor before backfilling", async () => {
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue(undefined)
    const paginateChunks = vi.fn().mockResolvedValue({
      continueCursor: "cursor_cleanup_2",
      isDone: false,
      page: [{ _id: "chunks_old_1" as never }]
    })

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            delete: deleteRow,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn(() => {
                      throw new Error("cleanup must use cursor pagination")
                    }),
                    paginate: paginateChunks
                  }))
                }
              }

              if (table === "chunkTerms") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([{ _id: "chunkTerms_1" as never }])
                  }))
                }
              }

              throw new Error(`Unexpected table ${table}`)
            })
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          cursor: null,
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          phase: "cleanup"
        }
      )
    ).resolves.toBeNull()

    expect(deleteRow).toHaveBeenCalledWith("chunkTerms", "chunkTerms_1")
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      cursor: "cursor_cleanup_2",
      documentId: "documents_1",
      jobId: "ingestionJobs_1",
      phase: "cleanup"
    })
  })

  it("fails a superseded job instead of leaving it stuck in embedding", async () => {
    const runMutation = vi.fn().mockResolvedValue(null)
    const collect = vi.fn(() => {
      throw new Error("current chunks must be read with bounded pagination")
    })
    const paginate = vi.fn().mockResolvedValue({
      continueCursor: "",
      isDone: true,
      page: [
        {
          _id: "chunks_new_1" as never,
          citationLabel: "Page 1",
          content: "New instructions",
          documentId: "documents_1" as never,
          ingestionJobId: "ingestionJobs_2" as never,
          isCurrent: true,
          pageNumber: 1
        }
      ]
    })

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect,
                    paginate
                  }))
                }
              }

              throw new Error(`Unexpected table ${table}`)
            })
          },
          runMutation,
          scheduler: {
            runAfter: vi.fn()
          }
        } as never,
        {
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          offset: 0,
          phase: "backfill"
        }
      )
    ).resolves.toBeNull()

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      documentId: "documents_1",
      errorMessage: "Exact-term indexing was superseded by a newer ingestion job.",
      jobId: "ingestionJobs_1"
    })
  })

  it("limits admin backfill work to one safe chunk batch", async () => {
    const chunks = Array.from({ length: 55 }, (_, index) => ({
      _id: `chunks_${index + 1}` as never,
      citationLabel: `Page ${index + 1}`,
      content: `Install module ${index + 1} beside the controller for proper operation and grounding.`,
      documentId: "documents_1" as never,
      ingestionJobId: "ingestionJobs_1" as never,
      isCurrent: true,
      pageNumber: index + 1
    }))
    const insert = vi.fn().mockResolvedValue(undefined)
    const collect = vi.fn(() => {
      throw new Error("admin backfill must not collect all current chunks")
    })
    const paginate = vi.fn().mockResolvedValue({
      continueCursor: "cursor_admin_2",
      isDone: false,
      page: chunks.slice(0, 50)
    })

    const inserted = await backfillExactTermsHandler._handler(
      {
        db: {
          insert,
          query: vi.fn((table: string) => {
            if (table === "chunks") {
              return {
                withIndex: vi.fn(() => ({
                  collect,
                  paginate
                }))
              }
            }

            if (table === "chunkTerms") {
              return {
                withIndex: vi.fn(() => ({
                  collect: vi.fn().mockResolvedValue([]),
                  take: vi.fn().mockResolvedValue([])
                }))
              }
            }

            if (table === "exactTermBackfillState") {
              return {
                withIndex: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue(null)
                }))
              }
            }

            if (table === "adminSessions") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue({
                    _id: "adminSessions_1",
                    expiresAt: Date.now() + 60_000,
                    username: "admin"
                  })
                }))
              }
            }

            throw new Error(`Unexpected table ${table}`)
          })
        }
      } as never,
      {
        sessionToken: "token-123"
      }
    )

    expect(inserted).toBeGreaterThan(0)
    expect(collect).not.toHaveBeenCalled()
    expect(paginate).toHaveBeenCalledWith({
      cursor: null,
      numItems: 50
    })
    expect(
      insert.mock.calls.some(([table, value]) => table === "chunkTerms" && (value as { chunkId: string }).chunkId === "chunks_51")
    ).toBe(false)
  })

  it("continues admin backfill after the first chunk batch already has current-version terms", async () => {
    const chunks = Array.from({ length: 55 }, (_, index) => ({
      _id: `chunks_${index + 1}` as never,
      citationLabel: `Page ${index + 1}`,
      content: `Install module ${index + 1} beside the controller for proper operation and grounding.`,
      documentId: "documents_1" as never,
      ingestionJobId: "ingestionJobs_1" as never,
      isCurrent: true,
      pageNumber: index + 1
    }))
    const chunksWithTerms = new Set(chunks.slice(0, 50).map((chunk) => chunk._id))
    const insert = vi.fn(async (_table: string, value: { chunkId: never }) => {
      chunksWithTerms.add(value.chunkId)
    })
    const collect = vi.fn(() => {
      throw new Error("admin backfill must scan bounded pages")
    })
    const paginate = vi
      .fn()
      .mockResolvedValueOnce({
        continueCursor: "cursor_admin_2",
        isDone: false,
        page: chunks.slice(0, 50)
      })
      .mockResolvedValueOnce({
        continueCursor: "",
        isDone: true,
        page: chunks.slice(50)
      })

    const inserted = await backfillExactTermsHandler._handler(
      {
        db: {
          insert,
          query: vi.fn((table: string) => {
            if (table === "chunks") {
              return {
                withIndex: vi.fn(() => ({
                  collect,
                  paginate
                }))
              }
            }

            if (table === "chunkTerms") {
              return {
                withIndex: vi.fn((_index: string, range: (q: { eq: (field: string, value: unknown) => unknown }) => void) => {
                  const filters: Array<[string, unknown]> = []
                  const builder = {
                    eq(field: string, value: unknown) {
                      filters.push([field, value])
                      return builder
                    }
                  }
                  range(builder)
                  const chunkId = filters.find(([field]) => field === "chunkId")?.[1] as never

                  return {
                    collect: vi
                      .fn()
                      .mockResolvedValue(chunksWithTerms.has(chunkId) ? [{ _id: `chunkTerms_${chunkId}`, version: 2 }] : []),
                    take: vi
                      .fn()
                      .mockResolvedValue(chunksWithTerms.has(chunkId) ? [{ _id: `chunkTerms_${chunkId}`, version: 2 }] : [])
                  }
                })
              }
            }

            if (table === "exactTermBackfillState") {
              return {
                withIndex: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue(null)
                }))
              }
            }

            if (table === "adminSessions") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue({
                    _id: "adminSessions_1",
                    expiresAt: Date.now() + 60_000,
                    username: "admin"
                  })
                }))
              }
            }

            throw new Error(`Unexpected table ${table}`)
          })
        }
      } as never,
      {
        sessionToken: "token-123"
      }
    )

    expect(inserted).toBeGreaterThan(0)
    expect(collect).not.toHaveBeenCalled()
    expect(paginate).toHaveBeenNthCalledWith(1, {
      cursor: null,
      numItems: 50
    })
    expect(paginate).toHaveBeenNthCalledWith(2, {
      cursor: "cursor_admin_2",
      numItems: 50
    })
    expect(chunksWithTerms.has("chunks_51" as never)).toBe(true)
  })

  it("resumes admin backfill from a stored cursor after a bounded scan window", async () => {
    const chunks = Array.from({ length: 401 }, (_, index) => ({
      _id: `chunks_${index + 1}` as never,
      citationLabel: `Page ${index + 1}`,
      content: `Diagnostic table lists F${String(index + 1).padStart(3, "0")} overvoltage reset instructions.`,
      documentId: "documents_1" as never,
      ingestionJobId: "ingestionJobs_1" as never,
      isCurrent: true,
      pageNumber: index + 1
    }))
    const termsByChunkId = new Map<string, Array<{ _id: never; chunkId: never; term: string; version?: number }>>()
    for (const chunk of chunks.slice(0, 400)) {
      termsByChunkId.set(String(chunk._id), [
        { _id: `chunkTerms_current_${chunk._id}` as never, chunkId: chunk._id, term: String(chunk._id), version: 2 }
      ])
    }
    termsByChunkId.set("chunks_401", [{ _id: "chunkTerms_old_401" as never, chunkId: "chunks_401" as never, term: "f401" }])

    type ExactTermBackfillStateTestRow = { _id: never; cursor?: string; key: string; updatedAt: number }
    let state: ExactTermBackfillStateTestRow | null = null
    const insert = vi.fn(
      async (table: string, value: { chunkId?: never; cursor?: string; key?: string; term?: string; version?: number }) => {
        if (table === "exactTermBackfillState") {
          state = { _id: "exactTermBackfillState_1" as never, cursor: value.cursor, key: value.key ?? "", updatedAt: 1 }
          return state._id
        }

        if (table === "chunkTerms" && value.chunkId && value.term) {
          const chunkId = String(value.chunkId)
          termsByChunkId.set(chunkId, [
            ...(termsByChunkId.get(chunkId) ?? []),
            {
              _id: `chunkTerms_new_${chunkId}_${termsByChunkId.get(chunkId)?.length ?? 0}` as never,
              chunkId: value.chunkId,
              term: value.term,
              version: value.version
            }
          ])
        }

        return `${table}_new` as never
      }
    )
    const patch = vi.fn(async (table: string, id: never, value: { cursor?: string; updatedAt?: number }) => {
      if (table === "exactTermBackfillState" && state?._id === id) {
        state = { ...state, ...value }
      }
    })
    const deleteRow = vi.fn(async (table: string, id: never) => {
      if (table === "exactTermBackfillState" && state?._id === id) {
        state = null
        return
      }

      if (table !== "chunkTerms") {
        return
      }

      for (const [chunkId, terms] of termsByChunkId) {
        termsByChunkId.set(
          chunkId,
          terms.filter((term) => term._id !== id)
        )
      }
    })
    const collect = vi.fn(() => {
      throw new Error("admin backfill must scan bounded pages")
    })
    const paginate = vi.fn(async ({ cursor }: { cursor: string | null; numItems: number }) => {
      if (cursor === null) {
        return { continueCursor: "cursor_admin_1", isDone: false, page: chunks.slice(0, 50) }
      }

      const pageMatch = /^cursor_admin_(\d+)$/.exec(cursor)
      if (pageMatch) {
        const pageIndex = Number(pageMatch[1])
        const start = pageIndex * 50
        return {
          continueCursor: pageIndex === 7 ? "cursor_after_window" : `cursor_admin_${pageIndex + 1}`,
          isDone: false,
          page: chunks.slice(start, start + 50)
        }
      }

      if (cursor === "cursor_after_window") {
        return { continueCursor: "", isDone: true, page: chunks.slice(400) }
      }

      throw new Error(`Unexpected cursor ${cursor}`)
    })
    const query = vi.fn((table: string) => {
      if (table === "chunks") {
        return {
          withIndex: vi.fn(() => ({
            collect,
            paginate
          }))
        }
      }

      if (table === "chunkTerms") {
        return {
          withIndex: vi.fn((_index: string, range: (q: { eq: (field: string, value: unknown) => unknown }) => void) => {
            const filters: Array<[string, unknown]> = []
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value])
                return builder
              }
            }
            range(builder)
            const chunkId = String(filters.find(([field]) => field === "chunkId")?.[1])
            const terms = termsByChunkId.get(chunkId) ?? []

            return {
              collect: vi.fn().mockResolvedValue(terms),
              take: vi.fn().mockResolvedValue(terms.slice(0, 1))
            }
          })
        }
      }

      if (table === "exactTermBackfillState") {
        return {
          withIndex: vi.fn(() => ({
            first: vi.fn(async () => state)
          }))
        }
      }

      if (table === "adminSessions") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn().mockResolvedValue({
              _id: "adminSessions_1",
              expiresAt: Date.now() + 60_000,
              username: "admin"
            })
          }))
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })
    const ctx = {
      db: {
        delete: deleteRow,
        insert,
        patch,
        query
      }
    } as never

    const firstInserted = await backfillExactTermsHandler._handler(ctx, { sessionToken: "token-123" })

    expect(firstInserted).toBe(0)
    expect((state as ExactTermBackfillStateTestRow | null)?.cursor).toBe("cursor_after_window")
    expect(collect).not.toHaveBeenCalled()

    const secondInserted = await backfillExactTermsHandler._handler(ctx, { sessionToken: "token-123" })

    expect(secondInserted).toBeGreaterThan(0)
    expect(paginate).toHaveBeenCalledWith({
      cursor: "cursor_after_window",
      numItems: 50
    })
    expect(termsByChunkId.get("chunks_401")?.some((term) => term.version === 2)).toBe(true)
    expect(state).toBeNull()
  })

  it("reindexes current chunks with versionless terms during admin backfill", async () => {
    const termsByChunkId = new Map<string, Array<{ _id: never; chunkId: never; term: string; version?: number }>>([
      ["chunks_1", [{ _id: "chunkTerms_old_1" as never, chunkId: "chunks_1" as never, term: "f002" }]]
    ])
    const insert = vi.fn(async (table: string, value: { chunkId: never; term: string; version?: number }) => {
      if (table !== "chunkTerms") {
        return
      }

      const chunkId = String(value.chunkId)
      termsByChunkId.set(chunkId, [
        ...(termsByChunkId.get(chunkId) ?? []),
        { _id: `chunkTerms_new_${termsByChunkId.get(chunkId)?.length ?? 0}` as never, ...value }
      ])
    })
    const deleteRow = vi.fn(async (table: string, id: string) => {
      if (table !== "chunkTerms") {
        return
      }

      for (const [chunkId, terms] of termsByChunkId) {
        termsByChunkId.set(
          chunkId,
          terms.filter((term) => term._id !== id)
        )
      }
    })
    const paginate = vi.fn().mockResolvedValue({
      continueCursor: "",
      isDone: true,
      page: [
        {
          _id: "chunks_1" as never,
          citationLabel: "Page 99",
          content: "Diagnostic table lists F002 overvoltage reset instructions.",
          documentId: "documents_1" as never,
          ingestionJobId: "ingestionJobs_1" as never,
          isCurrent: true,
          pageNumber: 99
        }
      ]
    })

    const inserted = await backfillExactTermsHandler._handler(
      {
        db: {
          delete: deleteRow,
          insert,
          query: vi.fn((table: string) => {
            if (table === "chunks") {
              return {
                withIndex: vi.fn(() => ({
                  collect: vi.fn(() => {
                    throw new Error("admin backfill must scan bounded pages")
                  }),
                  paginate
                }))
              }
            }

            if (table === "chunkTerms") {
              return {
                withIndex: vi.fn((_index: string, range: (q: { eq: (field: string, value: unknown) => unknown }) => void) => {
                  const filters: Array<[string, unknown]> = []
                  const builder = {
                    eq(field: string, value: unknown) {
                      filters.push([field, value])
                      return builder
                    }
                  }
                  range(builder)
                  const chunkId = String(filters.find(([field]) => field === "chunkId")?.[1])
                  const terms = termsByChunkId.get(chunkId) ?? []

                  return {
                    collect: vi.fn().mockResolvedValue(terms),
                    take: vi.fn().mockResolvedValue(terms.slice(0, 1))
                  }
                })
              }
            }

            if (table === "exactTermBackfillState") {
              return {
                withIndex: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue(null)
                }))
              }
            }

            if (table === "adminSessions") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue({
                    _id: "adminSessions_1",
                    expiresAt: Date.now() + 60_000,
                    username: "admin"
                  })
                }))
              }
            }

            throw new Error(`Unexpected table ${table}`)
          })
        }
      } as never,
      {
        sessionToken: "token-123"
      }
    )

    const insertedTerms = insert.mock.calls
      .filter(([table]) => table === "chunkTerms")
      .map(([, value]) => value as { version?: number })

    expect(inserted).toBeGreaterThan(0)
    expect(deleteRow).toHaveBeenCalledWith("chunkTerms", "chunkTerms_old_1")
    expect(insertedTerms.length).toBeGreaterThan(0)
    expect(insertedTerms.every((term) => term.version === 2)).toBe(true)
  })
})
