import { beforeEach, describe, expect, it, vi } from "vitest"

import { create, generateSourceUploadUrl, markFailed, replaceParsedContent } from "./documents"

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

const replaceParsedContentHandler = replaceParsedContent as typeof replaceParsedContent & {
  _handler: (
    ctx: unknown,
    args: {
      chunks: Array<{ citationLabel: string; chunkType: string; content: string; pageNumber: number }>
      documentId: never
      embeddings: number[][]
      jobId: never
      pages: Array<{ markdown: string; needsOcrFallback: boolean; pageNumber: number; printedPageNumber?: string }>
      sourceFileName: string
      sourceMimeType: string
      sourceStorageId: never
    }
  ) => Promise<null>
}

describe("create", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("stores the uploaded source file when creating a document", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("vendors_1")
      .mockResolvedValueOnce("products_1")
      .mockResolvedValueOnce("documents_1")
      .mockResolvedValueOnce("auditEvents_1")
    const query = vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        unique: vi.fn().mockResolvedValue(null)
      })
    })
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
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("generates an upload url for the admin upload flow", async () => {
    const generateUploadUrl = vi.fn().mockResolvedValue("https://upload.example/source")

    const result = await generateSourceUploadUrlHandler._handler(
      {
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
})

describe("replaceParsedContent", () => {
  it("schedules exact-term backfill instead of inserting chunk terms inline", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("documentAssets_1")
      .mockResolvedValueOnce("documentPages_1")
      .mockResolvedValueOnce("chunks_1")
      .mockResolvedValueOnce("chunkEmbeddings_1")
    const patch = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue(undefined)

    await expect(
      replaceParsedContentHandler._handler(
        {
          db: {
            get: vi
              .fn()
              .mockResolvedValueOnce({
                _id: "documents_1",
                productSlug: "guardlogix",
                vendorSlug: "rockwell"
              })
              .mockResolvedValueOnce({
                _id: "ingestionJobs_1",
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
          embeddings: [[0.1, 0.2]],
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
    ).resolves.toBeNull()

    expect(insert).not.toHaveBeenCalledWith("chunkTerms", expect.anything())
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: "documents_1",
      jobId: "ingestionJobs_1",
      offset: 0,
      phase: "cleanup"
    })
  })

  it("marks a previously ready document as processing before deferred exact-term indexing", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("documentAssets_1")
      .mockResolvedValueOnce("documentPages_1")
      .mockResolvedValueOnce("chunks_1")
      .mockResolvedValueOnce("chunkEmbeddings_1")
    const patch = vi.fn().mockResolvedValue(undefined)
    const runAfter = vi.fn().mockResolvedValue(undefined)

    await expect(
      replaceParsedContentHandler._handler(
        {
          db: {
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
          embeddings: [[0.1, 0.2]],
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
    ).resolves.toBeNull()

    expect(patch).toHaveBeenCalledWith(
      "documents",
      "documents_1",
      expect.objectContaining({
        status: "processing"
      })
    )
    expect(runAfter).toHaveBeenCalledTimes(1)
  })

  it("does not let an older job replace newer current artifacts", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn()
    const runAfter = vi.fn()

    await expect(
      replaceParsedContentHandler._handler(
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
                status: "embedding"
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
          embeddings: [[0.1, 0.2]],
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
    ).resolves.toBeNull()

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
})
