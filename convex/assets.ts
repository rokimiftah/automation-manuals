import { v } from "convex/values"

import { query } from "./_generated/server"
import { buildCitationLabel } from "./lib/normalize"

export function canResolveViewerAsset(input: { asset: { isCurrent: boolean } | null; document: { status: string } | null }) {
  return input.asset?.isCurrent === true && input.document?.status === "ready"
}

function resolvePageNumberByCitationLabel(
  pages: Array<{ pageNumber: number; printedPageNumber?: string }>,
  citationLabel: string | undefined
) {
  const normalizedLabel = citationLabel?.trim()
  if (!normalizedLabel) {
    return undefined
  }

  return pages.find((page) => buildCitationLabel(page.pageNumber, page.printedPageNumber) === normalizedLabel)?.pageNumber
}

export const resolveViewerAsset = query({
  args: { assetId: v.id("documentAssets"), citationLabel: v.optional(v.string()) },
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

    const pages = await ctx.db
      .query("documentPages")
      .withIndex("by_document_and_current", (q) => q.eq("documentId", asset.documentId).eq("isCurrent", true))
      .collect()
    const pageNumber = resolvePageNumberByCitationLabel(pages, args.citationLabel) ?? asset.pageNumber

    return {
      _id: asset._id,
      kind: "source_pdf" as const,
      ...(pageNumber === undefined ? {} : { pageNumber }),
      url
    }
  }
})
