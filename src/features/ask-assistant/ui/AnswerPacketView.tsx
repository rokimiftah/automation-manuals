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

export default function AnswerPacketView({ packet, onSelectCitation }: AnswerPacketViewProps) {
  const _isGrounded = packet.answerabilityStatus === "grounded"

  return (
    <section className="relative flex flex-col bg-white">
      <div className="space-y-10 p-6 md:p-8">
        <p className="font-mono text-[16px] leading-[1.8] whitespace-pre-wrap text-[#000000]">{packet.answerSummary}</p>

        {packet.answerSteps.length > 0 && (
          <div className="space-y-4">
            <h4 className="wire-border-b pb-2 text-[10px] font-medium tracking-[0.2em] text-[#000000] uppercase">Trace Log</h4>
            <ol className="space-y-3 font-mono text-[14px] leading-relaxed text-[#000000]">
              {packet.answerSteps.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="shrink-0 text-[#999999]">{(index + 1).toString().padStart(2, "0")}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {packet.citations.length > 0 && (
          <div className="wire-border-t space-y-4 pt-6">
            <h4 className="wire-border-b pb-2 text-[10px] font-medium tracking-[0.2em] text-[#000000] uppercase">
              Reference Nodes
            </h4>
            <div className="flex flex-wrap gap-3">
              {packet.citations.map((citation) => (
                <span key={citation.chunkId} className="wire-border px-3 py-1 font-mono text-[11px] text-[#000000]">
                  {citation.citationLabel}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="wire-border-t space-y-4 pt-6">
          <h4 className="wire-border-b pb-2 text-[10px] font-medium tracking-[0.2em] text-[#000000] uppercase">
            Attached Schematics
          </h4>
          {packet.supportingAssets.length === 0 ? (
            <div className="crosshatch-bg wire-border flex h-24 w-full items-center justify-center">
              <span className="wire-border bg-white px-4 py-1 font-mono text-[11px] tracking-widest uppercase">Null</span>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {packet.supportingAssets.map((asset) => (
                <button
                  key={`${asset.assetId}:${asset.pageNumber}`}
                  className="wire-border group relative flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-[#000000] hover:text-white md:p-5"
                  type="button"
                  onClick={() => onSelectCitation(asset)}
                >
                  <span className="mb-4 line-clamp-2 text-[14px] font-medium tracking-wide uppercase">{asset.label}</span>
                  <span className="mt-auto w-full border-t border-inherit pt-2 font-mono text-[11px] tracking-widest uppercase group-hover:border-white">
                    Pg. {asset.pageNumber}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
