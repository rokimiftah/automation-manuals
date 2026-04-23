import { describe, expect, it } from "vitest"

import { assertReadyDocumentArtifacts, buildReadyDocumentPatch } from "./documentReadiness"

describe("assertReadyDocumentArtifacts", () => {
  it("throws when the source asset is missing", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasAlignedEmbeddings: true,
        hasSourceAsset: false,
        pageCount: 1
      })
    ).toThrow("A current source asset is required before a document can become ready")
  })

  it("throws when no parsed pages exist", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasAlignedEmbeddings: true,
        hasSourceAsset: true,
        pageCount: 0
      })
    ).toThrow("At least one parsed page is required before a document can become ready")
  })

  it("throws when no searchable chunks exist", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 0,
        hasAlignedEmbeddings: false,
        hasSourceAsset: true,
        pageCount: 1
      } as never)
    ).toThrow("At least one searchable chunk is required before a document can become ready")
  })

  it("throws when current chunk embeddings are missing or misaligned", () => {
    expect(() =>
      assertReadyDocumentArtifacts({
        chunkCount: 1,
        hasAlignedEmbeddings: false,
        hasSourceAsset: true,
        pageCount: 1
      } as never)
    ).toThrow("Current chunk embeddings must align one-to-one with current chunks before a document can become ready")
  })
})

describe("buildReadyDocumentPatch", () => {
  it("marks a document ready without forcing a new active-search decision", () => {
    expect(buildReadyDocumentPatch({ now: 5_678, sourceAssetId: "asset-1" as never })).toEqual({
      sourceAssetId: "asset-1",
      status: "ready",
      updatedAt: 5_678
    })
  })
})
