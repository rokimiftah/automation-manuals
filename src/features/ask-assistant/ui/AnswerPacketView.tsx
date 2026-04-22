import type { AnswerabilityStatus } from "@entities/chat/model/types"
import type { Citation, SupportingAsset } from "@entities/knowledge/model/types"

export type AnswerPacketViewPacket = {
  answerabilityStatus: AnswerabilityStatus
  answerSummary: string
  answerSteps: string[]
  citations: Citation[]
  supportingAssets: SupportingAsset[]
}

export type AnswerPacketViewProps = {
  onSelectCitation: (asset: SupportingAsset) => void
  packet: AnswerPacketViewPacket
}

function statusStyles(answerabilityStatus: AnswerabilityStatus) {
  if (answerabilityStatus === "grounded") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-200"
}

export default function AnswerPacketView({ packet, onSelectCitation }: AnswerPacketViewProps) {
  return (
    <section className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
      <div className="space-y-2">
        <p className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] ${statusStyles(packet.answerabilityStatus)}`}>
          {packet.answerabilityStatus === "grounded" ? "Grounded answer" : "Insufficient evidence"}
        </p>
        <p className="text-base leading-7 text-slate-100">{packet.answerSummary}</p>
      </div>

      {packet.answerSteps.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Reasoning steps</p>
          <ol className="space-y-2 text-sm leading-6 text-slate-300">
            {packet.answerSteps.map((step, index) => (
              <li key={step} className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <span className="mr-2 font-mono text-cyan-300">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {packet.citations.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Citations</p>
          <div className="flex flex-wrap gap-2">
            {packet.citations.map((citation) => (
              <span
                key={citation.chunkId}
                className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-300"
              >
                {citation.citationLabel}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Supporting assets</p>
        {packet.supportingAssets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-4 py-5 text-sm leading-6 text-slate-400">
            No supporting assets were returned for this answer.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {packet.supportingAssets.map((asset) => (
              <button
                key={`${asset.assetId}:${asset.pageNumber}`}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white active:translate-y-px"
                type="button"
                onClick={() => onSelectCitation(asset)}
              >
                {asset.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
