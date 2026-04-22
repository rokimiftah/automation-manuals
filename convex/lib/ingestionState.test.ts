import { describe, expect, it } from "vitest"

import { assertNextIngestionStatus } from "./ingestionState"

describe("assertNextIngestionStatus", () => {
  it("allows queued -> downloading", () => {
    expect(() => assertNextIngestionStatus("queued", "downloading")).not.toThrow()
  })

  it("allows submitting -> waiting_provider", () => {
    expect(() => assertNextIngestionStatus("submitting", "waiting_provider")).not.toThrow()
  })

  it("allows processing_provider -> downloading_result", () => {
    expect(() => assertNextIngestionStatus("processing_provider", "downloading_result")).not.toThrow()
  })

  it("rejects embedding -> parsing", () => {
    expect(() => assertNextIngestionStatus("embedding", "submitting")).toThrow(
      "Invalid ingestion status transition"
    )
  })
})
