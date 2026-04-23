import { describe, expect, it } from "vitest"

import { assertReadyDocumentArtifacts, buildReadyDocumentPatch } from "./documentReadiness"

describe("assertReadyDocumentArtifacts", () => {
  it("throws when the source asset is missing", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasSourceAsset: false,
        pageCount: 1
      })
    ).toThrow("A current source asset is required before a document can become ready")
  })

  it("throws when no parsed pages exist", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasSourceAsset: true,
        pageCount: 0
      })
    ).toThrow("At least one parsed page is required before a document can become ready")
  })

  it("throws when no searchable chunks exist", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 0,
        hasSourceAsset: true,
        pageCount: 1
      })
    ).toThrow("At least one searchable chunk is required before a document can become ready")
  })
})

describe("buildReadyDocumentPatch", () => {
  it("marks ready documents as active so they remain searchable", () => {
    expect(buildReadyDocumentPatch({ now: 5_678, sourceAssetId: "asset-1" as never })).toEqual({
      isActive: true,
      sourceAssetId: "asset-1",
      status: "ready",
      updatedAt: 5_678
    })
  })
})
