import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { finalizeProviderResult } from "./ingestionNode"

const finalizeProviderResultHandler = finalizeProviderResult as typeof finalizeProviderResult & {
  _handler: (ctx: unknown, args: { documentId: never; jobId: never }) => Promise<null>
}

describe("finalizeProviderResult", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable"
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(runAfter).toHaveBeenCalledWith(30_000, expect.anything(), {
      jobId: "ingestionJobs_1"
    })
  })
})
