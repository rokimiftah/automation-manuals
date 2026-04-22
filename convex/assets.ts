import { v } from "convex/values"

import { query } from "./_generated/server"
import { requireAllowedViewer } from "./lib/viewer"

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
    await requireAllowedViewer(ctx)

    const asset = await ctx.db.get(args.assetId)
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
