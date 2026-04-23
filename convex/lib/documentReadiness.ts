import type { GenericId } from "convex/values"

export function assertReadyDocumentArtifacts(input: {
  chunkCount: number
  hasSourceAsset: boolean
  pageCount: number
}) {
  if (!input.hasSourceAsset) {
    throw new Error("A current source asset is required before a document can become ready")
  }

  if (input.pageCount < 1) {
    throw new Error("At least one parsed page is required before a document can become ready")
  }

  if (input.chunkCount < 1) {
    throw new Error("At least one searchable chunk is required before a document can become ready")
  }
}

export function buildReadyDocumentPatch(input: { now: number; sourceAssetId: GenericId<"documentAssets"> }) {
  return {
    isActive: true,
    sourceAssetId: input.sourceAssetId,
    status: "ready" as const,
    updatedAt: input.now
  }
}
