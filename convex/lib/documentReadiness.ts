import type { GenericId } from "convex/values"

export function buildReadyDocumentPatch(input: { now: number; sourceAssetId?: GenericId<"documentAssets"> }) {
  return {
    ...(input.sourceAssetId === undefined ? {} : { sourceAssetId: input.sourceAssetId }),
    isActive: true,
    status: "ready" as const,
    updatedAt: input.now
  }
}
