import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  isRecoverableStuckJob,
  isRetryableJob,
  listJobs,
  mineruCallback,
  prepareMineruUpload,
  recoverStuckJob,
  retry,
  selectMineruArchiveJson
} from "./ingestion"

const { requireAdminQuerySession, requireAdminWriteSession } = vi.hoisted(() => ({
  requireAdminQuerySession: vi.fn(),
  requireAdminWriteSession: vi.fn()
}))

vi.mock("./lib/adminSession", async () => {
  const actual = await vi.importActual<typeof import("./lib/adminSession")>("./lib/adminSession")
  return {
    ...actual,
    requireAdminQuerySession,
    requireAdminWriteSession
  }
})

const { getProviderEnv, submitMineruBatch } = vi.hoisted(() => ({
  getProviderEnv: vi.fn(),
  submitMineruBatch: vi.fn()
}))

vi.mock("./lib/env", async () => {
  const actual = await vi.importActual<typeof import("./lib/env")>("./lib/env")
  return {
    ...actual,
    getProviderEnv
  }
})

vi.mock("./lib/mineru", async () => {
  const actual = await vi.importActual<typeof import("./lib/mineru")>("./lib/mineru")
  return {
    ...actual,
    submitMineruBatch
  }
})

const prepareMineruUploadHandler = prepareMineruUpload as typeof prepareMineruUpload & {
  _handler: (
    ctx: unknown,
    args: {
      fileName: string
      sessionToken: string
      sourceStorageId: never
    }
  ) => Promise<{ batchId: string; traceId?: string }>
}

const listJobsHandler = listJobs as typeof listJobs & {
  _handler: (ctx: unknown, args: { sessionToken: string }) => Promise<unknown>
}

const retryHandler = retry as typeof retry & {
  _handler: (ctx: unknown, args: { jobId: never; sessionToken: string }) => Promise<never>
}

const recoverStuckJobHandler = recoverStuckJob as typeof recoverStuckJob & {
  _handler: (ctx: unknown, args: { jobId: never; sessionToken: string }) => Promise<null>
}

const mineruCallbackHandler = mineruCallback as typeof mineruCallback & {
  _handler: (ctx: unknown, request: Request) => Promise<Response>
}

describe("isRetryableJob", () => {
  it("allows retry only for the latest failed job of the document", () => {
    expect(
      isRetryableJob(
        {
          _creationTime: 1,
          _id: "ingestionJobs_1" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "failed"
        },
        [
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          }
        ]
      )
    ).toBe(true)

    expect(
      isRetryableJob(
        {
          _creationTime: 1,
          _id: "ingestionJobs_1" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "failed"
        },
        [
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2" as never,
            createdAt: 2,
            documentId: "documents_1" as never,
            status: "ready"
          }
        ]
      )
    ).toBe(false)

    expect(
      isRetryableJob(
        {
          _creationTime: 3,
          _id: "ingestionJobs_3" as never,
          createdAt: 3,
          documentId: "documents_2" as never,
          status: "processing_provider"
        },
        [
          {
            _creationTime: 3,
            _id: "ingestionJobs_3" as never,
            createdAt: 3,
            documentId: "documents_2" as never,
            status: "processing_provider"
          }
        ]
      )
    ).toBe(false)
  })

  it("breaks timestamp ties deterministically with Convex metadata", () => {
    expect(
      isRetryableJob(
        {
          _creationTime: 12,
          _id: "ingestionJobs_2" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "failed"
        },
        [
          {
            _creationTime: 11,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          },
          {
            _creationTime: 12,
            _id: "ingestionJobs_2" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          }
        ]
      )
    ).toBe(true)
  })
})

describe("isRecoverableStuckJob", () => {
  it("allows recovery only for the latest stale stuck job of the document", () => {
    expect(
      isRecoverableStuckJob(
        {
          _creationTime: 2,
          _id: "ingestionJobs_2" as never,
          createdAt: 2,
          documentId: "documents_1" as never,
          status: "submitting",
          updatedAt: 0
        },
        [
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "queued",
            updatedAt: 1
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2" as never,
            createdAt: 2,
            documentId: "documents_1" as never,
            status: "submitting",
            updatedAt: 0
          }
        ],
        15 * 60 * 1000
      )
    ).toBe(true)

    expect(
      isRecoverableStuckJob(
        {
          _creationTime: 1,
          _id: "ingestionJobs_1" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "normalizing",
          updatedAt: 1
        },
        [
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "normalizing",
            updatedAt: 1
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2" as never,
            createdAt: 2,
            documentId: "documents_1" as never,
            status: "ready",
            updatedAt: 2
          }
        ],
        15 * 60 * 1000
      )
    ).toBe(false)

    expect(
      isRecoverableStuckJob(
        {
          _creationTime: 3,
          _id: "ingestionJobs_3" as never,
          createdAt: 3,
          documentId: "documents_2" as never,
          status: "processing_provider",
          updatedAt: 0
        },
        [
          {
            _creationTime: 3,
            _id: "ingestionJobs_3" as never,
            createdAt: 3,
            documentId: "documents_2" as never,
            status: "processing_provider",
            updatedAt: 0
          }
        ],
        15 * 60 * 1000
      )
    ).toBe(false)

    expect(
      isRecoverableStuckJob(
        {
          _creationTime: 4,
          _id: "ingestionJobs_4" as never,
          createdAt: 4,
          documentId: "documents_3" as never,
          status: "normalizing",
          updatedAt: 15 * 60 * 1000 - 1
        },
        [
          {
            _creationTime: 4,
            _id: "ingestionJobs_4" as never,
            createdAt: 4,
            documentId: "documents_3" as never,
            status: "normalizing",
            updatedAt: 15 * 60 * 1000 - 1
          }
        ],
        15 * 60 * 1000
      )
    ).toBe(false)
  })
})

describe("listJobs", () => {
  beforeEach(() => {
    requireAdminQuerySession.mockReset()
    requireAdminQuerySession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("emits recoverableAt only for the latest stale stuck job per document", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-25T12:00:00.000Z"))

    const result = await listJobsHandler._handler(
      {
        db: {
          query: vi.fn(() => ({
            collect: vi.fn().mockResolvedValue([
              {
                _creationTime: 1,
                _id: "ingestionJobs_1" as never,
                createdAt: 1,
                documentId: "documents_1" as never,
                status: "submitting",
                updatedAt: Date.parse("2026-04-25T11:30:00.000Z")
              },
              {
                _creationTime: 2,
                _id: "ingestionJobs_2" as never,
                createdAt: 2,
                documentId: "documents_1" as never,
                status: "normalizing",
                updatedAt: Date.parse("2026-04-25T11:40:00.000Z")
              },
              {
                _creationTime: 3,
                _id: "ingestionJobs_3" as never,
                createdAt: 3,
                documentId: "documents_2" as never,
                status: "submitting",
                updatedAt: Date.parse("2026-04-25T11:50:00.000Z")
              },
              {
                _creationTime: 4,
                _id: "ingestionJobs_4" as never,
                createdAt: 4,
                documentId: "documents_3" as never,
                status: "failed",
                updatedAt: Date.parse("2026-04-25T11:00:00.000Z")
              }
            ])
          }))
        }
      } as never,
      { sessionToken: "token-123" }
    )

    expect(result).toEqual([
      expect.objectContaining({
        _id: "ingestionJobs_1",
        serverNow: Date.parse("2026-04-25T12:00:00.000Z")
      }),
      expect.objectContaining({
        _id: "ingestionJobs_2",
        recoverableAt: Date.parse("2026-04-25T11:55:00.000Z"),
        serverNow: Date.parse("2026-04-25T12:00:00.000Z")
      }),
      expect.objectContaining({
        _id: "ingestionJobs_3",
        recoverableAt: Date.parse("2026-04-25T12:05:00.000Z"),
        serverNow: Date.parse("2026-04-25T12:00:00.000Z")
      }),
      expect.objectContaining({
        _id: "ingestionJobs_4",
        serverNow: Date.parse("2026-04-25T12:00:00.000Z")
      })
    ])

    vi.useRealTimers()
  })
})

describe("prepareMineruUpload", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
    getProviderEnv.mockReset()
    submitMineruBatch.mockReset()
    getProviderEnv.mockReturnValue({
      mineruApiToken: "mineru-token",
      mistralApiKey: "mistral-token",
      mistralChatModel: "mistral-small-latest",
      mistralEmbedModel: "mistral-embed",
      mineruDailyPriorityPages: 1000,
      mineruDailyFileLimit: 5000,
      mineruSubmitRatePerMinute: 50,
      mineruResultQueryRatePerMinute: 1000
    })
    submitMineruBatch.mockResolvedValue({ batchId: "batch-1", traceId: "trace-1" })
  })

  it("uploads the stored pdf to MinerU on the server", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" })
    const storageGet = vi.fn().mockResolvedValue(blob)
    const runQuery = vi.fn().mockResolvedValue([])

    const result = await prepareMineruUploadHandler._handler(
      {
        runQuery,
        storage: {
          get: storageGet
        }
      } as never,
      {
        fileName: "manual.pdf",
        sessionToken: "token-123",
        sourceStorageId: "_storage_1" as never
      }
    )

    expect(storageGet).toHaveBeenCalledWith("_storage_1")
    expect(submitMineruBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        file: blob,
        fileName: "manual.pdf",
        token: "mineru-token"
      })
    )
    expect(result).toEqual({ batchId: "batch-1", traceId: "trace-1" })
  })
})

describe("retry", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("copies the original source file metadata into the retry job", async () => {
    const insert = vi.fn().mockResolvedValue("ingestionJobs_retry")
    const runAfter = vi.fn().mockResolvedValue(undefined)
    const existingJob = {
      _id: "ingestionJobs_1" as never,
      _creationTime: 1,
      createdAt: 1,
      documentId: "documents_1" as never,
      sourceFileName: "manual.pdf",
      sourceMimeType: "application/pdf",
      sourceStorageId: "_storage_1" as never,
      status: "failed",
      updatedAt: 1
    }

    await retryHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue(existingJob),
          insert,
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              collect: vi.fn().mockResolvedValue([existingJob])
            }))
          }))
        },
        scheduler: {
          runAfter
        }
      } as never,
      {
        jobId: "ingestionJobs_1" as never,
        sessionToken: "token-123"
      }
    )

    expect(insert).toHaveBeenCalledWith(
      "ingestionJobs",
      expect.objectContaining({
        documentId: "documents_1",
        requestedByAdmin: "admin",
        sourceFileName: "manual.pdf",
        sourceMimeType: "application/pdf",
        sourceStorageId: "_storage_1",
        status: "queued"
      })
    )
    expect(runAfter).toHaveBeenCalled()
  })
})

describe("recoverStuckJob", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("marks the latest submitting job as failed so it can be retried", async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockResolvedValue(undefined)
    const existingJob = {
      _id: "ingestionJobs_1" as never,
      _creationTime: 2,
      createdAt: 2,
      documentId: "documents_1" as never,
      status: "submitting",
      updatedAt: 0
    }

    await expect(
      recoverStuckJobHandler._handler(
        {
          db: {
            get: vi.fn().mockResolvedValueOnce(existingJob).mockResolvedValueOnce({ _id: "documents_1", status: "processing" }),
            insert,
            patch,
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([existingJob])
              }))
            }))
          }
        } as never,
        {
          jobId: "ingestionJobs_1" as never,
          sessionToken: "token-123"
        }
      )
    ).resolves.toBeNull()

    expect(patch).toHaveBeenCalledWith(
      "ingestionJobs",
      "ingestionJobs_1",
      expect.objectContaining({
        errorMessage: "Admin recovery marked this stuck ingestion job as failed.",
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
  })

  it("rejects recovery for non-latest stuck jobs", async () => {
    const existingJob = {
      _id: "ingestionJobs_1" as never,
      _creationTime: 1,
      createdAt: 1,
      documentId: "documents_1" as never,
      status: "normalizing",
      updatedAt: 0
    }

    await expect(
      recoverStuckJobHandler._handler(
        {
          db: {
            get: vi.fn().mockResolvedValue(existingJob),
            insert: vi.fn(),
            patch: vi.fn(),
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([
                  existingJob,
                  {
                    _id: "ingestionJobs_2" as never,
                    _creationTime: 2,
                    createdAt: 2,
                    documentId: "documents_1" as never,
                    status: "ready"
                  }
                ])
              }))
            }))
          }
        } as never,
        {
          jobId: "ingestionJobs_1" as never,
          sessionToken: "token-123"
        }
      )
    ).rejects.toThrow("Only the latest stale ingestion job can be recovered")
  })

  it("rejects recovery for recent in-flight jobs", async () => {
    const existingJob = {
      _id: "ingestionJobs_1" as never,
      _creationTime: 1,
      createdAt: 1,
      documentId: "documents_1" as never,
      status: "submitting",
      updatedAt: Date.now()
    }

    await expect(
      recoverStuckJobHandler._handler(
        {
          db: {
            get: vi.fn().mockResolvedValue(existingJob),
            insert: vi.fn(),
            patch: vi.fn(),
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([existingJob])
              }))
            }))
          }
        } as never,
        {
          jobId: "ingestionJobs_1" as never,
          sessionToken: "token-123"
        }
      )
    ).rejects.toThrow("Only the latest stale ingestion job can be recovered")
  })

  it("treats an already recovered job as a no-op", async () => {
    await expect(
      recoverStuckJobHandler._handler(
        {
          db: {
            get: vi.fn().mockResolvedValue({
              _id: "ingestionJobs_1" as never,
              _creationTime: 1,
              createdAt: 1,
              documentId: "documents_1" as never,
              errorMessage: "Admin recovery marked this stuck ingestion job as failed.",
              status: "failed",
              updatedAt: 0
            }),
            insert: vi.fn(),
            patch: vi.fn(),
            query: vi.fn()
          }
        } as never,
        {
          jobId: "ingestionJobs_1" as never,
          sessionToken: "token-123"
        }
      )
    ).resolves.toBeNull()
  })
})

describe("selectMineruArchiveJson", () => {
  it("reads layout.json from MinerU zip archives", () => {
    const layoutFixture = {
      pdf_info: [
        {
          page_idx: 0,
          para_blocks: []
        }
      ]
    }

    const files = {
      "layout.json": new TextEncoder().encode(JSON.stringify(layoutFixture))
    }

    expect(selectMineruArchiveJson(files)).toEqual(layoutFixture)
  })
})

describe("mineruCallback", () => {
  it("returns 400 when signed callback content has a non-string batch id", async () => {
    process.env.MINERU_CALLBACK_UID = "uid-1"
    getProviderEnv.mockReturnValue({
      mineruApiToken: "mineru-token",
      mineruCallbackSeed: "seed-1",
      mineruCallbackUid: "uid-1",
      mineruCallbackUrl: "https://app.example/providers/mineru/callback",
      mineruDailyFileLimit: 5000,
      mineruDailyPriorityPages: 1000,
      mineruResultQueryRatePerMinute: 1000,
      mineruSubmitRatePerMinute: 50,
      mistralApiKey: "mistral-test-key",
      mistralChatModel: "mistral-small-latest",
      mistralEmbedModel: "mistral-embed"
    })

    const content = JSON.stringify({ batch_id: 123 })
    const checksum = await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(`uid-1seed-1${content}`))
      .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""))
    const request = new Request("https://app.example/providers/mineru/callback", {
      body: JSON.stringify({ checksum, content }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })

    const response = await mineruCallbackHandler._handler(
      {
        runMutation: vi.fn(),
        runQuery: vi.fn(),
        scheduler: { runAfter: vi.fn() }
      } as never,
      request
    )

    await expect(response.text()).resolves.toBe("MinerU callback is missing batch_id")
    expect(response.status).toBe(400)

    delete process.env.MINERU_CALLBACK_UID
  })
})
