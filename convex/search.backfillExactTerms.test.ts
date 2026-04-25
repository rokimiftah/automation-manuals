import { describe, expect, it, vi } from "vitest"

import { backfillDocumentExactTermsBatch, backfillExactTerms } from "./search"

const { requireAdminWriteSession } = vi.hoisted(() => ({
  requireAdminWriteSession: vi.fn()
}))

vi.mock("./lib/adminSession", async () => {
  const actual = await vi.importActual<typeof import("./lib/adminSession")>("./lib/adminSession")
  return {
    ...actual,
    requireAdminWriteSession
  }
})

const backfillDocumentExactTermsBatchHandler = backfillDocumentExactTermsBatch as typeof backfillDocumentExactTermsBatch & {
  _handler: (
    ctx: unknown,
    args: { documentId: never; jobId: never; offset: number; phase?: "cleanup" | "backfill" }
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

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            insert,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue(chunks)
                  }))
                }
              }

              if (table === "chunkTerms") {
                return {
                  withIndex: vi.fn(() => ({
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
      offset: 50,
      phase: "backfill"
    })
  })

  it("cleans stale chunk terms before handing off to backfill", async () => {
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue(undefined)

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            delete: deleteRow,
            query: vi.fn((table: string) => {
              if (table === "chunks") {
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
                    const isCurrent = filters.find(([field]) => field === "isCurrent")?.[1]

                    return {
                      collect: vi.fn().mockResolvedValue(
                        isCurrent === false
                          ? [
                              {
                                _id: "chunks_old_1" as never,
                                citationLabel: "Page 1",
                                content: "Old instructions",
                                documentId: "documents_1" as never,
                                isCurrent: false,
                                pageNumber: 1
                              }
                            ]
                          : []
                      )
                    }
                  })
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
      offset: 0,
      phase: "backfill"
    })
  })

  it("fails a superseded job instead of leaving it stuck in embedding", async () => {
    const runMutation = vi.fn().mockResolvedValue(null)

    await expect(
      backfillDocumentExactTermsBatchHandler._handler(
        {
          db: {
            query: vi.fn((table: string) => {
              if (table === "chunks") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([
                      {
                        _id: "chunks_new_1" as never,
                        citationLabel: "Page 1",
                        content: "New instructions",
                        documentId: "documents_1" as never,
                        ingestionJobId: "ingestionJobs_2" as never,
                        isCurrent: true,
                        pageNumber: 1
                      }
                    ])
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
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })

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

    const inserted = await backfillExactTermsHandler._handler(
      {
        db: {
          insert,
          query: vi.fn((table: string) => {
            if (table === "chunks") {
              return {
                withIndex: vi.fn(() => ({
                  collect: vi.fn().mockResolvedValue(chunks)
                }))
              }
            }

            if (table === "chunkTerms") {
              return {
                withIndex: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue([])
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
    expect(
      insert.mock.calls.some(([table, value]) => table === "chunkTerms" && (value as { chunkId: string }).chunkId === "chunks_51")
    ).toBe(false)
  })
})
