import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  create,
  deleteDocument,
  generateSourceUploadUrl,
  insertChunkEmbeddingsBatch,
  markFailed,
  markReady,
  stageParsedContent
} from "./documents"

const createHandler = create as typeof create & {
  _handler: (
    ctx: unknown,
    args: {
      language: string
      productName: string
      sessionToken: string
      sourceStorageId: unknown
      title: string
      vendorName: string
      version: string
    }
  ) => Promise<unknown>
}

const deleteDocumentHandler = deleteDocument as typeof deleteDocument & {
  _handler: (ctx: unknown, args: { documentId: never; sessionToken: string }) => Promise<null>
}

const generateSourceUploadUrlHandler = generateSourceUploadUrl as typeof generateSourceUploadUrl & {
  _handler: (ctx: unknown, args: { sessionToken: string }) => Promise<string>
}

const markFailedHandler = markFailed as typeof markFailed & {
  _handler: (
    ctx: unknown,
    args: {
      documentId: never
      errorMessage?: string
      jobId: never
    }
  ) => Promise<null>
}

const markReadyHandler = markReady as typeof markReady & {
  _handler: (ctx: unknown, args: { documentId: never }) => Promise<null>
}

const stageParsedContentHandler = stageParsedContent as typeof stageParsedContent & {
  _handler: (
    ctx: unknown,
    args: {
      chunks: Array<{ citationLabel: string; chunkType: string; content: string; pageNumber: number }>
      documentId: never
      jobId: never
      pages: Array<{ markdown: string; needsOcrFallback: boolean; pageNumber: number; printedPageNumber?: string }>
      sourceFileName: string
      sourceMimeType: string
      sourceStorageId: never
    }
  ) => Promise<never[]>
}

const insertChunkEmbeddingsBatchHandler = insertChunkEmbeddingsBatch as typeof insertChunkEmbeddingsBatch & {
  _handler: (
    ctx: unknown,
    args: {
      attemptCount: number
      batchId: never
      chunkIds: never[]
      embeddingModel: string
      embeddings: number[][]
      jobId: never
    }
  ) => Promise<number>
}

function createEmbedding() {
  return Array.from({ length: 1024 }, (_, index) => index / 1024)
}

describe("create", () => {
  it("stores the uploaded source file when creating a document", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("vendors_1")
      .mockResolvedValueOnce("products_1")
      .mockResolvedValueOnce("documents_1")
      .mockResolvedValueOnce("auditEvents_1")
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn().mockReturnValue({
        unique: vi.fn().mockResolvedValue(
          table === "adminSessions"
            ? {
                _id: "adminSessions_1",
                expiresAt: Date.now() + 1_000,
                username: "admin"
              }
            : null
        )
      })
    }))
    const storageGetUrl = vi.fn().mockResolvedValue("https://convex.example/api/storage/source")

    await createHandler._handler(
      {
        db: {
          insert,
          query
        },
        storage: {
          getUrl: storageGetUrl
        }
      } as never,
      {
        language: "English",
        productName: "GuardLogix 5570 Controllers",
        sessionToken: "token-123",
        sourceStorageId: "_storage_1" as never,
        title: "GuardLogix 5570 Controllers User Manual",
        vendorName: "Rockwell Automation",
        version: "20.01"
      }
    )

    expect(storageGetUrl).toHaveBeenCalledWith("_storage_1")
    expect(insert).toHaveBeenCalledWith(
      "documents",
      expect.objectContaining({
        sourceUrl: "https://convex.example/api/storage/source"
      })
    )
  })
})

describe("generateSourceUploadUrl", () => {
  it("generates an upload url for the admin upload flow", async () => {
    const generateUploadUrl = vi.fn().mockResolvedValue("https://upload.example/source")

    const result = await generateSourceUploadUrlHandler._handler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn().mockReturnValue({
              unique: vi.fn().mockResolvedValue({
                _id: "adminSessions_1",
                expiresAt: Date.now() + 1_000,
                username: "admin"
              })
            })
          }))
        },
        storage: {
          generateUploadUrl
        }
      } as never,
      {
        sessionToken: "token-123"
      }
    )

    expect(result).toBe("https://upload.example/source")
    expect(generateUploadUrl).toHaveBeenCalledTimes(1)
  })
})

describe("deleteDocument", () => {
  it("deletes durable embedding batches with the document", async () => {
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const storageDelete = vi.fn().mockResolvedValue(undefined)
    const rows: Record<string, unknown[]> = {
      answerEvidence: [],
      chunkEmbeddings: [{ _id: "chunkEmbeddings_1" }],
      chunks: [{ _id: "chunks_1" }],
      chunkTerms: [{ _id: "chunkTerms_1" }],
      documentAssets: [{ _id: "documentAssets_1", storageId: "_storage_asset" }],
      documentPages: [{ _id: "documentPages_1" }],
      embeddingBatches: [{ _id: "embeddingBatches_1" }],
      ingestionJobs: [{ _id: "ingestionJobs_1", sourceStorageId: "_storage_job" }]
    }

    await deleteDocumentHandler._handler(
      {
        db: {
          delete: deleteRow,
          get: vi.fn().mockResolvedValue({
            _id: "documents_1",
            title: "GuardLogix",
            version: "20.01"
          }),
          insert: vi.fn(),
          query: vi.fn((table: string) => ({
            withIndex: vi.fn(() => ({
              collect: vi.fn().mockResolvedValue(rows[table] ?? []),
              unique: vi.fn().mockResolvedValue(
                table === "adminSessions"
                  ? {
                      _id: "adminSessions_1",
                      expiresAt: Date.now() + 1_000,
                      username: "admin"
                    }
                  : null
              )
            }))
          }))
        },
        storage: {
          delete: storageDelete
        }
      } as never,
      {
        documentId: "documents_1" as never,
        sessionToken: "token-123"
      }
    )

    expect(deleteRow).toHaveBeenCalledWith("embeddingBatches", "embeddingBatches_1")
  })
})

describe("markFailed", () => {
  it("is idempotent when the job is already failed", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        collect: vi.fn().mockResolvedValue([
          {
            _creationTime: 1,
            _id: "ingestionJobs_1",
            createdAt: 1,
            documentId: "documents_1"
          }
        ])
      })
    })

    await expect(
      markFailedHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "failed"
              })
              .mockResolvedValueOnce({
                _id: "documents_1",
                status: "failed"
              }),
            patch,
            query
          }
        } as never,
        {
          documentId: "documents_1" as never,
          errorMessage: "already failed",
          jobId: "ingestionJobs_1" as never
        }
      )
    ).resolves.toBeNull()

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith(
      "documents",
      "documents_1",
      expect.objectContaining({
        status: "failed"
      })
    )
  })

  it("does not regress the document when an older job fails late", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        collect: vi.fn().mockResolvedValue([
          {
            _creationTime: 1,
            _id: "ingestionJobs_1",
            createdAt: 1,
            documentId: "documents_1"
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2",
            createdAt: 2,
            documentId: "documents_1"
          }
        ])
      })
    })

    await expect(
      markFailedHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "normalizing"
              })
              .mockResolvedValueOnce({
                _id: "documents_1",
                status: "ready"
              }),
            patch,
            query
          }
        } as never,
        {
          documentId: "documents_1" as never,
          errorMessage: "late failure",
          jobId: "ingestionJobs_1" as never
        }
      )
    ).resolves.toBeNull()

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith(
      "ingestionJobs",
      "ingestionJobs_1",
      expect.objectContaining({
        status: "failed"
      })
    )
  })

  it("does not patch a failed job when it belongs to another document", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        collect: vi.fn().mockResolvedValue([
          {
            _creationTime: 2,
            _id: "ingestionJobs_2",
            createdAt: 2,
            documentId: "documents_1"
          }
        ])
      })
    })

    await expect(
      markFailedHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_2",
                status: "normalizing"
              })
              .mockResolvedValueOnce({
                _id: "documents_1",
                status: "processing"
              }),
            patch,
            query
          }
        } as never,
        {
          documentId: "documents_1" as never,
          errorMessage: "wrong document",
          jobId: "ingestionJobs_1" as never
        }
      )
    ).resolves.toBeNull()

    expect(patch).not.toHaveBeenCalledWith("ingestionJobs", "ingestionJobs_1", expect.anything())
  })
})

describe("stageParsedContent", () => {
  it("does not expose the legacy direct embedding replacement mutation", () => {
    const source = readFileSync(join(process.cwd(), "convex/documents.ts"), "utf8")

    expect(source).not.toContain("replaceParsedContent")
  })

  it("supersedes current artifacts before staging pages and chunks without embeddings or exact-term indexing", async () => {
    const operations: string[] = []
    let pageInsertCount = 0
    let chunkInsertCount = 0
    const insert = vi.fn(async (table: string) => {
      operations.push(`insert:${table}`)
      if (table === "documentAssets") {
        return "documentAssets_new"
      }
      if (table === "documentPages") {
        pageInsertCount += 1
        return `documentPages_new_${pageInsertCount}`
      }
      if (table === "chunks") {
        chunkInsertCount += 1
        return `chunks_new_${chunkInsertCount}`
      }
      return `${table}_new`
    })
    const patch = vi.fn(async (table: string, id: string) => {
      operations.push(`patch:${table}:${id}`)
    })
    const deleteDoc = vi.fn(async (table: string, id: string) => {
      operations.push(`delete:${table}:${id}`)
    })
    const queryResults: Record<string, unknown[]> = {
      chunkEmbeddings: [{ _id: "chunkEmbeddings_old" }],
      chunks: [{ _id: "chunks_old" }],
      documentAssets: [{ _id: "documentAssets_old" }],
      documentPages: [{ _id: "documentPages_old" }],
      ingestionJobs: [
        {
          _creationTime: 1,
          _id: "ingestionJobs_1",
          createdAt: 1,
          documentId: "documents_1"
        }
      ]
    }
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue(queryResults[table] ?? [])
      }))
    }))
    const runAfter = vi.fn().mockResolvedValue(undefined)

    const result = await stageParsedContentHandler._handler(
      {
        db: {
          delete: deleteDoc,
          get: vi
            .fn()
            .mockResolvedValueOnce({
              _id: "documents_1",
              productSlug: "guardlogix",
              status: "ready",
              vendorSlug: "rockwell"
            })
            .mockResolvedValueOnce({
              _id: "ingestionJobs_1",
              documentId: "documents_1",
              status: "normalizing"
            }),
          insert,
          patch,
          query
        },
        scheduler: {
          runAfter
        }
      } as never,
      {
        chunks: [
          {
            citationLabel: "Page 1",
            chunkType: "text",
            content: "Install the module beside the controller.",
            pageNumber: 1
          },
          {
            citationLabel: "Page 2",
            chunkType: "warning",
            content: "Do not remove the module under power.",
            pageNumber: 2
          }
        ],
        documentId: "documents_1" as never,
        jobId: "ingestionJobs_1" as never,
        pages: [
          {
            markdown: "Install the module beside the controller.",
            needsOcrFallback: false,
            pageNumber: 1
          }
        ],
        sourceFileName: "manual.pdf",
        sourceMimeType: "application/pdf",
        sourceStorageId: "_storage_1" as never
      }
    )

    expect(result).toEqual(["chunks_new_1", "chunks_new_2"])
    expect(patch).toHaveBeenCalledWith("documentAssets", "documentAssets_old", { isCurrent: false })
    expect(patch).toHaveBeenCalledWith("documentPages", "documentPages_old", { isCurrent: false })
    expect(patch).toHaveBeenCalledWith("chunks", "chunks_old", { isCurrent: false })
    expect(deleteDoc).toHaveBeenCalledWith("chunkEmbeddings", "chunkEmbeddings_old")
    expect(insert).toHaveBeenCalledWith(
      "documentAssets",
      expect.objectContaining({
        documentId: "documents_1",
        fileName: "manual.pdf",
        ingestionJobId: "ingestionJobs_1",
        isCurrent: true,
        mimeType: "application/pdf",
        storageId: "_storage_1"
      })
    )
    expect(insert).toHaveBeenCalledWith(
      "documentPages",
      expect.objectContaining({
        documentId: "documents_1",
        ingestionJobId: "ingestionJobs_1",
        isCurrent: true,
        markdown: "Install the module beside the controller."
      })
    )
    expect(insert).toHaveBeenCalledWith(
      "chunks",
      expect.objectContaining({
        chunkType: "text",
        content: "Install the module beside the controller.",
        documentId: "documents_1",
        ingestionJobId: "ingestionJobs_1",
        isCurrent: true
      })
    )
    expect(insert).not.toHaveBeenCalledWith("chunkEmbeddings", expect.anything())
    expect(patch).toHaveBeenCalledWith(
      "documents",
      "documents_1",
      expect.objectContaining({
        status: "processing"
      })
    )
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      chunkIds: ["chunks_new_1", "chunks_new_2"],
      documentId: "documents_1",
      jobId: "ingestionJobs_1"
    })

    const firstNewInsertIndex = operations.indexOf("insert:documentAssets")
    expect(operations.indexOf("patch:documentAssets:documentAssets_old")).toBeLessThan(firstNewInsertIndex)
    expect(operations.indexOf("patch:documentPages:documentPages_old")).toBeLessThan(firstNewInsertIndex)
    expect(operations.indexOf("patch:chunks:chunks_old")).toBeLessThan(firstNewInsertIndex)
    expect(operations.indexOf("delete:chunkEmbeddings:chunkEmbeddings_old")).toBeLessThan(firstNewInsertIndex)
  })

  it("fails finalization without replacing current content when staged chunks are empty", async () => {
    const insert = vi.fn()
    const patch = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue(
          table === "ingestionJobs"
            ? [
                {
                  _creationTime: 1,
                  _id: "ingestionJobs_1",
                  createdAt: 1,
                  documentId: "documents_1"
                }
              ]
            : []
        )
      }))
    }))
    const runAfter = vi.fn().mockResolvedValue(undefined)

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            delete: vi.fn(),
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "ready",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "normalizing"
              }),
            insert,
            patch,
            query
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          chunks: [],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "No searchable chunks on this page.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).resolves.toEqual([])

    expect(insert).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledWith(
      "ingestionJobs",
      "ingestionJobs_1",
      expect.objectContaining({
        errorMessage: "At least one searchable chunk is required before a document can become ready",
        status: "failed"
      })
    )
    expect(patch).toHaveBeenCalledWith(
      "documents",
      "documents_1",
      expect.objectContaining({
        status: "failed"
      })
    )
    expect(runAfter).not.toHaveBeenCalled()
  })

  it("stages finalization directly from downloading_result and schedules durable batch creation", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("documentAssets_new")
      .mockResolvedValueOnce("documentPages_new")
      .mockResolvedValueOnce("chunks_new")
    const patch = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            delete: vi.fn(),
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "processing",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "downloading_result"
              }),
            insert,
            patch,
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue(
                  table === "ingestionJobs"
                    ? [
                        {
                          _creationTime: 1,
                          _id: "ingestionJobs_1",
                          createdAt: 1,
                          documentId: "documents_1"
                        }
                      ]
                    : []
                )
              }))
            }))
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          chunks: [
            {
              citationLabel: "Page 1",
              chunkType: "text",
              content: "Install the module beside the controller.",
              pageNumber: 1
            }
          ],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "Install the module beside the controller.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).resolves.toEqual(["chunks_new"])

    expect(patch).toHaveBeenCalledWith(
      "ingestionJobs",
      "ingestionJobs_1",
      expect.objectContaining({
        status: "embedding"
      })
    )
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      chunkIds: ["chunks_new"],
      documentId: "documents_1",
      jobId: "ingestionJobs_1"
    })
  })

  it("does not restage content after the job has entered embedding", async () => {
    const insert = vi.fn()
    const patch = vi.fn()
    const runAfter = vi.fn()

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            delete: vi.fn(),
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "processing",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "embedding"
              }),
            insert,
            patch,
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue(
                  table === "ingestionJobs"
                    ? [
                        {
                          _creationTime: 1,
                          _id: "ingestionJobs_1",
                          createdAt: 1,
                          documentId: "documents_1"
                        }
                      ]
                    : []
                )
              }))
            }))
          },
          scheduler: { runAfter }
        } as never,
        {
          chunks: [
            {
              citationLabel: "Page 1",
              chunkType: "text",
              content: "Install the module beside the controller.",
              pageNumber: 1
            }
          ],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "Install the module beside the controller.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).resolves.toEqual([])

    expect(insert).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
    expect(runAfter).not.toHaveBeenCalled()
  })

  it("rejects a latest failed job before staging empty chunks", async () => {
    const insert = vi.fn()
    const patch = vi.fn()
    const deleteDoc = vi.fn()
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue(
          table === "ingestionJobs"
            ? [
                {
                  _creationTime: 1,
                  _id: "ingestionJobs_1",
                  createdAt: 1,
                  documentId: "documents_1"
                }
              ]
            : []
        )
      }))
    }))

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            delete: deleteDoc,
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "ready",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "failed"
              }),
            insert,
            patch,
            query
          },
          scheduler: {
            runAfter: vi.fn()
          }
        } as never,
        {
          chunks: [],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "No searchable chunks on this page.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).rejects.toThrow("Invalid ingestion status transition: failed -> failed")

    expect(insert).not.toHaveBeenCalled()
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it("does not patch a stale job failed when it belongs to another document", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn()
    const runAfter = vi.fn()

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "processing",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_2",
                status: "normalizing"
              }),
            insert,
            patch,
            query: vi.fn((table: string) => {
              if (table === "ingestionJobs") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([
                      {
                        _creationTime: 2,
                        _id: "ingestionJobs_2",
                        createdAt: 2,
                        documentId: "documents_1"
                      }
                    ])
                  }))
                }
              }

              return {
                withIndex: vi.fn(() => ({
                  collect: vi.fn().mockResolvedValue([])
                }))
              }
            })
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          chunks: [
            {
              citationLabel: "Page 1",
              chunkType: "text",
              content: "Install the module beside the controller.",
              pageNumber: 1
            }
          ],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "Install the module beside the controller.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).resolves.toEqual([])

    expect(insert).not.toHaveBeenCalled()
    expect(runAfter).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalledWith("ingestionJobs", "ingestionJobs_1", expect.anything())
  })

  it("does not let an older job stage content over newer artifacts", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn()
    const runAfter = vi.fn()

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "processing",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "normalizing"
              }),
            insert,
            patch,
            query: vi.fn((table: string) => {
              if (table === "ingestionJobs") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([
                      {
                        _creationTime: 1,
                        _id: "ingestionJobs_1",
                        createdAt: 1,
                        documentId: "documents_1"
                      },
                      {
                        _creationTime: 2,
                        _id: "ingestionJobs_2",
                        createdAt: 2,
                        documentId: "documents_1"
                      }
                    ])
                  }))
                }
              }

              return {
                withIndex: vi.fn(() => ({
                  collect: vi.fn().mockResolvedValue([])
                }))
              }
            })
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          chunks: [
            {
              citationLabel: "Page 1",
              chunkType: "text",
              content: "Install the module beside the controller.",
              pageNumber: 1
            }
          ],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "Install the module beside the controller.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).resolves.toEqual([])

    expect(insert).not.toHaveBeenCalled()
    expect(runAfter).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledWith(
      "ingestionJobs",
      "ingestionJobs_1",
      expect.objectContaining({
        errorMessage: "A newer ingestion job replaced this result before it could be committed.",
        status: "failed"
      })
    )
  })

  it("no-ops stale terminal jobs before validating ready transition", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn()
    const runAfter = vi.fn()

    await expect(
      stageParsedContentHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                status: "processing",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
                documentId: "documents_1",
                status: "ready"
              }),
            insert,
            patch,
            query: vi.fn((table: string) => {
              if (table === "ingestionJobs") {
                return {
                  withIndex: vi.fn(() => ({
                    collect: vi.fn().mockResolvedValue([
                      {
                        _creationTime: 1,
                        _id: "ingestionJobs_1",
                        createdAt: 1,
                        documentId: "documents_1"
                      },
                      {
                        _creationTime: 2,
                        _id: "ingestionJobs_2",
                        createdAt: 2,
                        documentId: "documents_1"
                      }
                    ])
                  }))
                }
              }

              return {
                withIndex: vi.fn(() => ({
                  collect: vi.fn().mockResolvedValue([])
                }))
              }
            })
          },
          scheduler: {
            runAfter
          }
        } as never,
        {
          chunks: [
            {
              citationLabel: "Page 1",
              chunkType: "text",
              content: "Install the module beside the controller.",
              pageNumber: 1
            }
          ],
          documentId: "documents_1" as never,
          jobId: "ingestionJobs_1" as never,
          pages: [
            {
              markdown: "Install the module beside the controller.",
              needsOcrFallback: false,
              pageNumber: 1
            }
          ],
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1" as never
        }
      )
    ).resolves.toEqual([])

    expect(insert).not.toHaveBeenCalled()
    expect(runAfter).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })
})

describe("markReady", () => {
  it("rejects current embeddings that do not align one-to-one with current chunks", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const queryResults: Record<string, unknown[]> = {
      chunkEmbeddings: [
        {
          _id: "chunkEmbeddings_1",
          chunkId: "chunks_1"
        },
        {
          _id: "chunkEmbeddings_2",
          chunkId: "chunks_1"
        }
      ],
      chunks: [
        {
          _id: "chunks_1"
        },
        {
          _id: "chunks_2"
        }
      ],
      documentAssets: [
        {
          _id: "documentAssets_1",
          kind: "source_pdf"
        }
      ],
      documentPages: [
        {
          _id: "documentPages_1"
        }
      ]
    }

    await expect(
      markReadyHandler._handler(
        {
          db: {
            get: vi.fn().mockResolvedValue({
              _id: "documents_1"
            }),
            patch,
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue(queryResults[table] ?? [])
              }))
            }))
          }
        } as never,
        {
          documentId: "documents_1" as never
        }
      )
    ).rejects.toThrow("Current chunk embeddings must align one-to-one with current chunks before a document can become ready")

    expect(patch).not.toHaveBeenCalled()
  })
})

describe("insertChunkEmbeddingsBatch", () => {
  it("inserts missing current chunk embeddings with Jina metadata", async () => {
    const insert = vi.fn().mockResolvedValue("chunkEmbeddings_1")
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([])
      }))
    }))
    const embedding = createEmbedding()

    const result = await insertChunkEmbeddingsBatchHandler._handler(
      {
        db: {
          get: vi.fn(async (table: string, id?: string) => {
            if (id === undefined && table === "embeddingBatches_1") {
              return {
                _id: "embeddingBatches_1",
                attemptCount: 1,
                chunkIds: ["chunks_1"],
                jobId: "ingestionJobs_1",
                status: "processing"
              }
            }
            if (table === "chunks") {
              return {
                _id: id,
                chunkType: "text",
                documentId: "documents_1",
                isCurrent: true
              }
            }
            if (table === "documents") {
              return {
                _id: id,
                productSlug: "guardlogix",
                vendorSlug: "rockwell"
              }
            }
            return null
          }),
          insert,
          query
        }
      } as never,
      {
        attemptCount: 1,
        batchId: "embeddingBatches_1" as never,
        chunkIds: ["chunks_1" as never],
        embeddingModel: "jina-embeddings-v5-text-small",
        embeddings: [embedding],
        jobId: "ingestionJobs_1" as never
      }
    )

    expect(result).toBe(1)
    expect(insert).toHaveBeenCalledWith(
      "chunkEmbeddings",
      expect.objectContaining({
        chunkId: "chunks_1",
        documentCurrentKey: "documents_1:current",
        documentId: "documents_1",
        embedding,
        embeddingDimensions: 1024,
        embeddingModel: "jina-embeddings-v5-text-small",
        embeddingProvider: "jina",
        embeddingTask: "retrieval.passage",
        isCurrent: true,
        productSlug: "guardlogix",
        vendorSlug: "rockwell"
      })
    )
  })

  it("does not insert duplicate embeddings for a repeated batch", async () => {
    const insert = vi.fn().mockResolvedValue("chunkEmbeddings_1")
    let embeddingLookupCount = 0
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn(async () => {
          if (table !== "chunkEmbeddings") {
            return []
          }

          embeddingLookupCount += 1
          return embeddingLookupCount === 1
            ? []
            : [
                {
                  _id: "chunkEmbeddings_1",
                  chunkId: "chunks_1",
                  isCurrent: true
                }
              ]
        })
      }))
    }))
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id?: string) => {
          if (id === undefined && table === "embeddingBatches_1") {
            return {
              _id: "embeddingBatches_1",
              attemptCount: 1,
              chunkIds: ["chunks_1"],
              jobId: "ingestionJobs_1",
              status: "processing"
            }
          }
          if (table === "chunks") {
            return {
              _id: id,
              chunkType: "text",
              documentId: "documents_1",
              isCurrent: true
            }
          }
          if (table === "documents") {
            return {
              _id: id,
              productSlug: "guardlogix",
              vendorSlug: "rockwell"
            }
          }
          return null
        }),
        insert,
        query
      }
    }
    const args = {
      attemptCount: 1,
      batchId: "embeddingBatches_1" as never,
      chunkIds: ["chunks_1" as never],
      embeddingModel: "jina-embeddings-v5-text-small",
      embeddings: [createEmbedding()],
      jobId: "ingestionJobs_1" as never
    }

    await expect(insertChunkEmbeddingsBatchHandler._handler(ctx as never, args)).resolves.toBe(1)
    await expect(insertChunkEmbeddingsBatchHandler._handler(ctx as never, args)).resolves.toBe(0)

    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("rejects misaligned chunk ids and embeddings", async () => {
    await expect(
      insertChunkEmbeddingsBatchHandler._handler(
        {
          db: {
            get: vi.fn(),
            insert: vi.fn(),
            query: vi.fn()
          }
        } as never,
        {
          attemptCount: 1,
          batchId: "embeddingBatches_1" as never,
          chunkIds: ["chunks_1" as never],
          embeddingModel: "jina-embeddings-v5-text-small",
          embeddings: [],
          jobId: "ingestionJobs_1" as never
        }
      )
    ).rejects.toThrow("Chunk embeddings are misaligned")
  })

  it("does not insert embeddings for stale claimed attempts", async () => {
    const insert = vi.fn()

    await expect(
      insertChunkEmbeddingsBatchHandler._handler(
        {
          db: {
            get: vi.fn(async (table: string, id?: string) => {
              if (id === undefined && table === "embeddingBatches_1") {
                return {
                  _id: "embeddingBatches_1",
                  attemptCount: 2,
                  chunkIds: ["chunks_1"],
                  jobId: "ingestionJobs_1",
                  status: "processing"
                }
              }
              return null
            }),
            insert,
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([])
              }))
            }))
          }
        } as never,
        {
          attemptCount: 1,
          batchId: "embeddingBatches_1" as never,
          chunkIds: ["chunks_1" as never],
          embeddingModel: "jina-embeddings-v5-text-small",
          embeddings: [createEmbedding()],
          jobId: "ingestionJobs_1" as never
        }
      )
    ).resolves.toBe(0)

    expect(insert).not.toHaveBeenCalled()
  })
})
