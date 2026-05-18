import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = {
  decodeMineruArchiveJson: vi.fn(() => ({
    pdf_info: [
      {
        discarded_blocks: [
          {
            lines: [{ spans: [{ content: "A-1", type: "text" }] }],
            type: "page_number"
          }
        ],
        page_idx: 0,
        para_blocks: [
          {
            lines: [{ spans: [{ content: "Installation", type: "text" }] }],
            type: "title"
          },
          {
            lines: [
              {
                spans: [
                  {
                    content: "Install module.",
                    type: "text"
                  }
                ]
              }
            ],
            type: "text"
          }
        ]
      }
    ]
  })),
  embedDocumentTexts: vi.fn()
}

vi.mock("./ingestion", () => ({
  decodeMineruArchiveJson: mocks.decodeMineruArchiveJson
}))

vi.mock("./lib/jina", () => ({
  embedDocumentTexts: mocks.embedDocumentTexts
}))

const { finalizeProviderResult } = await import("./ingestionNode")

const finalizeProviderResultHandler = finalizeProviderResult as typeof finalizeProviderResult & {
  _handler: (ctx: unknown, args: { documentId: never; jobId: never }) => Promise<null>
}

let originalFetch: typeof globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

describe("finalizeProviderResult", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    originalFetch = globalThis.fetch
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable"
    })
    globalThis.fetch = fetchMock as never
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("imports normalized payload building without legacy OCR or embedding providers", () => {
    const source = readFileSync(join(process.cwd(), "convex/ingestionNode.ts"), "utf8")
    const documentsSource = readFileSync(join(process.cwd(), "convex/documents.ts"), "utf8")
    const embeddingBatchesSource = readFileSync(join(process.cwd(), "convex/embeddingBatches.ts"), "utf8")

    expect(source).toContain("buildNormalizedDocumentPayload")
    expect(source).not.toContain("buildDocumentPayload")
    expect(source).not.toContain("ocrPdfPage")
    expect(source).not.toContain("embedTexts")
    expect(documentsSource).toContain("internal.embeddingBatches.createBatchesForJob")
    expect(embeddingBatchesSource).toContain("internal.embeddingBatches.processNextBatch")
  })

  it("reconciles again instead of failing permanently when result download fails", async () => {
    const runMutation = vi.fn(async (_reference: unknown, _args: unknown) => true)
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")

    await finalizeProviderResultHandler._handler(
      {
        runMutation,
        runQuery: vi.fn(async () => ({
          _id: "ingestionJobs_1",
          documentId: "documents_1",
          providerReconcileFailureCount: 0,
          providerResultUrl: "https://mineru.example/result.zip",
          providerState: "done",
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1",
          status: "downloading_result"
        })),
        scheduler: { runAfter },
        storage: {
          getUrl: vi.fn()
        }
      } as never,
      {
        documentId: "documents_1" as never,
        jobId: "ingestionJobs_1" as never
      }
    )

    const mutationArgs = runMutation.mock.calls.map(([, args]) => args)
    expect(mutationArgs).toContainEqual(
      expect.objectContaining({
        jobId: "ingestionJobs_1",
        providerErrorMessage: "Failed to download MinerU result: 503 Service Unavailable",
        providerReconcileFailureCount: 1,
        providerState: "done",
        status: "downloading_result"
      })
    )
    expect(mutationArgs).not.toContainEqual(
      expect.objectContaining({
        documentId: "documents_1",
        errorMessage: "Failed to download MinerU result: 503 Service Unavailable"
      })
    )
    expect(mutationArgs).toContainEqual(
      expect.objectContaining({
        jobId: "ingestionJobs_1",
        reconcileAfterMs: 30_000
      })
    )
    expect(runAfter).not.toHaveBeenCalled()
  })

  it("schedules a finalization retry when result download fails after finalization was claimed", async () => {
    const runMutation = vi.fn(async (_reference: unknown, _args: unknown) => true)

    await finalizeProviderResultHandler._handler(
      {
        runMutation,
        runQuery: vi.fn(async () => ({
          _id: "ingestionJobs_1",
          documentId: "documents_1",
          providerReconcileFailureCount: 0,
          providerResultUrl: "https://mineru.example/result.zip",
          providerState: "done",
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1",
          status: "normalizing"
        })),
        scheduler: { runAfter: vi.fn() },
        storage: { getUrl: vi.fn() }
      } as never,
      {
        documentId: "documents_1" as never,
        jobId: "ingestionJobs_1" as never
      }
    )

    expect(runMutation.mock.calls.map(([, args]) => args)).toContainEqual(
      expect.objectContaining({
        finalizeAfterMs: 30_000,
        finalizeDocumentId: "documents_1",
        jobId: "ingestionJobs_1",
        providerErrorMessage: "Failed to download MinerU result: 503 Service Unavailable",
        providerReconcileFailureCount: 1,
        providerState: "done",
        status: "normalizing"
      })
    )
  })

  it("stages normalized MinerU output and defers embedding work to durable mutations", async () => {
    const sourceStorageGetUrl = vi.fn().mockResolvedValue("https://convex.example/source.pdf")
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")
    const runMutation = vi.fn(async (_reference: unknown, mutationArgs: unknown) => {
      if (
        mutationArgs &&
        typeof mutationArgs === "object" &&
        "chunks" in mutationArgs &&
        "pages" in mutationArgs &&
        !("embeddings" in mutationArgs)
      ) {
        return ["chunks_1"]
      }

      if (mutationArgs && typeof mutationArgs === "object" && "chunkIds" in mutationArgs) {
        return 1
      }

      return true
    })

    fetchMock.mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      ok: true
    } as never)

    await finalizeProviderResultHandler._handler(
      {
        runMutation,
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({
            _id: "ingestionJobs_1",
            documentId: "documents_1",
            providerResultUrl: "https://mineru.example/result.zip",
            sourceFileName: "manual.pdf",
            sourceMimeType: "application/pdf",
            sourceStorageId: "_storage_1",
            status: "downloading_result"
          })
          .mockResolvedValueOnce({
            _id: "documents_1",
            productSlug: "guardlogix",
            status: "processing",
            vendorSlug: "rockwell"
          }),
        scheduler: { runAfter },
        storage: {
          getUrl: sourceStorageGetUrl
        }
      } as never,
      {
        documentId: "documents_1" as never,
        jobId: "ingestionJobs_1" as never
      }
    )

    expect(sourceStorageGetUrl).not.toHaveBeenCalled()
    expect(mocks.embedDocumentTexts).not.toHaveBeenCalled()

    const mutationArgs = runMutation.mock.calls.map(([, calledArgs]) => calledArgs)
    const claimIndex = mutationArgs.findIndex((calledArgs) => {
      return calledArgs && typeof calledArgs === "object" && "jobId" in calledArgs && Object.keys(calledArgs).length === 1
    })
    const stagedArgs = mutationArgs.find((calledArgs) => {
      return (
        calledArgs &&
        typeof calledArgs === "object" &&
        "chunks" in calledArgs &&
        "pages" in calledArgs &&
        !("embeddings" in calledArgs)
      )
    })
    const stageIndex = mutationArgs.indexOf(stagedArgs)
    expect(claimIndex).toBeGreaterThanOrEqual(0)
    expect(claimIndex).toBeLessThan(stageIndex)
    expect(stagedArgs).toEqual(
      expect.objectContaining({
        chunks: [
          expect.objectContaining({
            content: "# Installation\n\nInstall module.",
            pageNumber: 1
          })
        ],
        documentId: "documents_1",
        jobId: "ingestionJobs_1",
        pages: [
          expect.objectContaining({
            markdown: "# Installation\n\nInstall module.",
            needsOcrFallback: true,
            pageNumber: 1,
            printedPageNumber: "A-1"
          })
        ],
        sourceFileName: "manual.pdf",
        sourceMimeType: "application/pdf",
        sourceStorageId: "_storage_1"
      })
    )

    const documentsSource = readFileSync(join(process.cwd(), "convex/documents.ts"), "utf8")
    const embeddingBatchesSource = readFileSync(join(process.cwd(), "convex/embeddingBatches.ts"), "utf8")
    expect(documentsSource).toContain("internal.embeddingBatches.createBatchesForJob")
    expect(embeddingBatchesSource).toContain("internal.embeddingBatches.processNextBatch")
    expect(runAfter).not.toHaveBeenCalled()
  })

  it("does not stage content when another finalizer already claimed the job", async () => {
    const runMutation = vi.fn(async (_reference: unknown, mutationArgs: unknown) => {
      if (mutationArgs && typeof mutationArgs === "object" && "jobId" in mutationArgs && Object.keys(mutationArgs).length === 1) {
        return false
      }

      return true
    })

    fetchMock.mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      ok: true
    } as never)

    await finalizeProviderResultHandler._handler(
      {
        runMutation,
        runQuery: vi.fn().mockResolvedValue({
          _id: "ingestionJobs_1",
          documentId: "documents_1",
          providerResultUrl: "https://mineru.example/result.zip",
          sourceFileName: "manual.pdf",
          sourceMimeType: "application/pdf",
          sourceStorageId: "_storage_1",
          status: "downloading_result"
        }),
        scheduler: { runAfter: vi.fn() },
        storage: { getUrl: vi.fn() }
      } as never,
      {
        documentId: "documents_1" as never,
        jobId: "ingestionJobs_1" as never
      }
    )

    expect(runMutation.mock.calls.map(([, args]) => args)).not.toContainEqual(
      expect.objectContaining({
        chunks: expect.any(Array),
        pages: expect.any(Array)
      })
    )
  })
})
