import { describe, expect, it } from "vitest"

import { buildReadyDocumentPatch } from "./documentReadiness"

describe("buildReadyDocumentPatch", () => {
  it("marks ready documents as active so they remain searchable", () => {
    expect(buildReadyDocumentPatch({ now: 1_234 })).toEqual({
      isActive: true,
      status: "ready",
      updatedAt: 1_234
    })
  })

  it("preserves the current source asset when one is provided", () => {
    expect(buildReadyDocumentPatch({ now: 5_678, sourceAssetId: "asset-1" as never })).toEqual({
      isActive: true,
      sourceAssetId: "asset-1",
      status: "ready",
      updatedAt: 5_678
    })
  })
})
