import { v } from "convex/values"

import { query } from "./_generated/server"

export function canResolveViewerAsset(input: { asset: { isCurrent: boolean } | null; document: { status: string } | null }) {
  return input.asset?.isCurrent === true && input.document?.status === "ready"
}

export const resolveViewerAsset = query({
  args: { assetId: v.id("documentAssets") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documentAssets"),
      kind: v.literal("source_pdf"),
      pageNumber: v.optional(v.number()),
      url: v.string()
    })
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    const document = asset ? await ctx.db.get(asset.documentId) : null

    if (!canResolveViewerAsset({ asset, document })) {
      return null
    }
    if (!asset) {
      return null
    }

    const url = await ctx.storage.getUrl(asset.storageId)
    if (!url) {
      return null
    }

    return {
      _id: asset._id,
      kind: "source_pdf" as const,
      ...(asset.pageNumber === undefined ? {} : { pageNumber: asset.pageNumber }),
      url
    }
  }
})
