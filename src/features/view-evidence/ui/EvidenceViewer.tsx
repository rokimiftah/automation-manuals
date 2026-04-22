import type { SupportingAsset } from "@entities/knowledge/model/types"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

export default function EvidenceViewer({ asset }: { asset: SupportingAsset | null }) {
  const viewerAsset = useQuery(api.assets.resolveViewerAsset, asset ? { assetId: asset.assetId } : "skip")

  if (!asset) {
    return (
      <section className="flex min-h-[24rem] items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/80 p-6 text-sm leading-6 text-slate-400 shadow-xl shadow-slate-950/30">
        Select a citation to open the supporting PDF page.
      </section>
    )
  }

  if (viewerAsset === undefined) {
    return (
      <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Evidence viewer</p>
          <h2 className="text-2xl font-semibold text-white">Loading evidence</h2>
          <p className="text-sm leading-6 text-slate-400">
            Fetching the cited source PDF page for the supporting text, table, or diagram evidence.
          </p>
        </div>
        <div className="h-[34rem] animate-pulse rounded-2xl border border-slate-800 bg-slate-950/60" />
      </section>
    )
  }

  if (!viewerAsset) {
    return (
      <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Evidence viewer</p>
          <h2 className="text-2xl font-semibold text-white">Supporting asset unavailable</h2>
        </div>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm leading-6 text-rose-200">
          The linked asset could not be resolved from storage.
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 shadow-xl shadow-slate-950/30">
      <div className="border-b border-slate-800 px-5 py-4">
        <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Evidence viewer</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold text-white">{asset.label}</h2>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium tracking-[0.25em] text-slate-300 uppercase">
            Page <span className="font-mono">{asset.pageNumber}</span>
          </span>
        </div>
      </div>
      <iframe className="h-[34rem] w-full bg-white" src={`${viewerAsset.url}#page=${asset.pageNumber}`} title={asset.label} />
    </section>
  )
}
