import type { Id } from "@convex/_generated/dataModel"

export type Citation = {
  assetId?: Id<"documentAssets">
  citationLabel: string
  chunkId: Id<"chunks">
  pageNumber: number
}

export type SupportingAsset = {
  assetId: Id<"documentAssets">
  label: string
  pageNumber: number
}
