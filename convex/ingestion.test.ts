import { beforeEach, describe, expect, it, vi } from "vitest"

import { isRetryableJob, prepareMineruUpload, selectMineruArchiveJson } from "./ingestion"

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

describe("prepareMineruUpload", () => {
  beforeEach(() => {
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
