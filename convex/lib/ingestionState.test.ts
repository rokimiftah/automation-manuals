import { describe, expect, it } from "vitest"

import { assertNextIngestionStatus } from "./ingestionState"

describe("assertNextIngestionStatus", () => {
  it("allows queued -> downloading", () => {
    expect(() => assertNextIngestionStatus("queued", "downloading")).not.toThrow()
  })

  it("rejects embedding -> parsing", () => {
    expect(() => assertNextIngestionStatus("embedding", "parsing")).toThrow(
      "Invalid ingestion status transition"
    )
  })
})
