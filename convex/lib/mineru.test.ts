import { describe, expect, it, vi } from "vitest"

import { getMineruBatchResult, mapMineruBatchState, prepareMineruBatchUpload, submitMineruBatch } from "./mineru"

describe("submitMineruBatch", () => {
  it("creates a batch and uploads exactly one file", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: { batch_id: "batch-1", file_urls: ["https://upload.example/file.pdf"] },
            msg: "ok",
            trace_id: "trace-1"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const result = await submitMineruBatch({
      file: new Blob(["pdf"], { type: "application/pdf" }),
      fileName: "manual.pdf",
      fetch: request,
      token: "token"
    })

    expect(result).toEqual({ batchId: "batch-1", traceId: "trace-1" })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://mineru.net/api/v4/file-urls/batch",
      expect.objectContaining({
        body: JSON.stringify({
          files: [{ name: "manual.pdf" }],
          model_version: "vlm"
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json"
        }),
        method: "POST"
      })
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://upload.example/file.pdf",
      expect.objectContaining({
        body: expect.any(ArrayBuffer),
        method: "PUT"
      })
    )
    expect(request.mock.calls[1]?.[1]).not.toHaveProperty("headers")
  })

  it("includes callback configuration when provided", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: { batch_id: "batch-2", file_urls: ["https://upload.example/file-2.pdf"] },
            msg: "ok",
            trace_id: "trace-2"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    await submitMineruBatch({
      callbackSeed: "seed-1",
      callbackUrl: "https://app.example/providers/mineru/callback",
      file: new Blob(["pdf"], { type: "application/pdf" }),
      fileName: "manual.pdf",
      fetch: request,
      token: "token"
    })

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://mineru.net/api/v4/file-urls/batch",
      expect.objectContaining({
        body: JSON.stringify({
          callback: "https://app.example/providers/mineru/callback",
          files: [{ name: "manual.pdf" }],
          model_version: "vlm",
          seed: "seed-1"
        })
      })
    )
  })
})

describe("prepareMineruBatchUpload", () => {
  it("creates a batch and returns the upload url", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: { batch_id: "batch-1", file_urls: ["https://upload.example/file.pdf"] },
          msg: "ok",
          trace_id: "trace-1"
        }),
        { status: 200 }
      )
    )

    const result = await prepareMineruBatchUpload({
      fileName: "manual.pdf",
      fetch: request,
      token: "token"
    })

    expect(result).toEqual({
      batchId: "batch-1",
      traceId: "trace-1",
      uploadUrl: "https://upload.example/file.pdf"
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      "https://mineru.net/api/v4/file-urls/batch",
      expect.objectContaining({
        body: JSON.stringify({
          files: [{ name: "manual.pdf" }],
          model_version: "vlm"
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json"
        }),
        method: "POST"
      })
    )
  })
})

describe("getMineruBatchResult", () => {
  it("queries the batch result endpoint", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            batch_id: "batch-1",
            extract_result: [{ file_name: "manual.pdf", state: "done", full_zip_url: "https://cdn.example/manual.zip" }]
          },
          msg: "ok",
          trace_id: "trace-2"
        }),
        { status: 200 }
      )
    )

    const result = await getMineruBatchResult({
      batchId: "batch-1",
      fetch: request,
      token: "token"
    })

    expect(request).toHaveBeenCalledWith(
      "https://mineru.net/api/v4/extract-results/batch/batch-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" })
      })
    )
    expect(result.traceId).toBe("trace-2")
    expect(result.results[0]?.state).toBe("done")
  })
})

describe("mapMineruBatchState", () => {
  it("maps pending provider work to waiting_provider", () => {
    expect(mapMineruBatchState("pending")).toBe("waiting_provider")
  })

  it("maps running and converting provider work to processing_provider", () => {
    expect(mapMineruBatchState("running")).toBe("processing_provider")
    expect(mapMineruBatchState("converting")).toBe("processing_provider")
  })

  it("maps done to downloading_result", () => {
    expect(mapMineruBatchState("done")).toBe("downloading_result")
  })
})
