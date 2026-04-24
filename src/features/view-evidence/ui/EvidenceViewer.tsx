import type { SupportingAsset } from "@entities/knowledge/model/types"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

export default function EvidenceViewer({ asset }: { asset: SupportingAsset | null }) {
  const viewerAsset = useQuery(api.assets.resolveViewerAsset, asset ? { assetId: asset.assetId } : "skip")

  if (!asset) {
    return (
      <section className="wire-border relative flex min-h-160 flex-1 items-center justify-center border-dashed bg-white p-10 text-center font-mono text-[11px] tracking-[0.2em] text-[#000000] uppercase">
        Awaiting...
      </section>
    )
  }

  if (viewerAsset === undefined) {
    return (
      <section className="wire-border relative flex h-full min-h-0 flex-1 flex-col bg-white">
        <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-4 md:p-6">
          <h3 className="text-[14px] font-medium tracking-wide text-[#000000] uppercase">Visual Output</h3>
          <span className="wire-border px-3 py-1 font-mono text-[10px] font-medium tracking-widest text-[#000000] uppercase">
            Loading...
          </span>
        </div>
        <div className="min-h-0 flex-1 p-4 md:p-6">
          <div className="crosshatch-bg wire-border h-full w-full animate-pulse" />
        </div>
      </section>
    )
  }

  if (!viewerAsset) {
    return (
      <section className="wire-border relative flex h-full min-h-0 flex-1 flex-col bg-white">
        <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-4 md:p-6">
          <h3 className="text-[14px] font-medium tracking-wide text-[#000000] uppercase">Visual Output</h3>
          <span className="wire-border bg-[#000000] px-3 py-1 font-mono text-[10px] font-medium tracking-widest text-white uppercase">
            Error 404
          </span>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#FAFAFA] p-6 md:p-8">
          <div className="wire-border diagonal-bg max-w-sm bg-white p-8 text-center">
            <span className="wire-border mb-2 inline-block bg-white px-4 py-2 text-[14px] font-medium tracking-widest uppercase">
              File Missing
            </span>
            <p className="bg-white p-2 font-mono text-[12px] text-[#000000]">Reference removed from storage.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="wire-border relative flex flex-1 flex-col bg-white">
      <div className="wire-border-b flex flex-col justify-between gap-4 bg-[#FAFAFA] p-4 md:flex-row md:items-center md:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="h-1.5 w-1.5 shrink-0 bg-[#000000]"></span>
          <h3 className="truncate text-[14px] font-medium tracking-wide text-[#000000] uppercase">{asset.label}</h3>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4 md:p-6">
        <iframe
          className="wire-border h-full w-full bg-white"
          src={`${viewerAsset.url}#page=${asset.pageNumber}`}
          title={asset.label}
        />
      </div>
    </section>
  )
}
