import type { Id } from "@convex/_generated/dataModel"
import type { SupportingAsset } from "@entities/knowledge/model/types"
import type { AnswerPacketViewPacket } from "@features/ask-assistant/ui"

import { startTransition, useState } from "react"

import { useAction } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { AnswerPacketView, QuestionComposer } from "@features/ask-assistant/ui"
import EvidenceViewer from "@features/view-evidence/ui"

export default function EngineerWorkspace() {
  const ask = useAction(api.search.ask)
  const [sessionId, setSessionId] = useState<Id<"chatSessions"> | null>(null)
  const [packet, setPacket] = useState<AnswerPacketViewPacket | null>(null)
  const [activeAsset, setActiveAsset] = useState<SupportingAsset | null>(null)
  const [error, setError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <AppShell title="Engineer Workspace">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div className="space-y-6">
          <QuestionComposer
            disabled={isSubmitting}
            onSubmit={(question) => {
              setError(undefined)
              setIsSubmitting(true)

              void (async () => {
                try {
                  const result = await ask({ question, sessionId: sessionId ?? undefined })

                  startTransition(() => {
                    setSessionId(result.sessionId)
                    setPacket(result)
                    setActiveAsset(result.supportingAssets[0] ?? null)
                  })
                } catch (submitError) {
                  setError(submitError instanceof Error ? submitError.message : "Unable to answer the question.")
                } finally {
                  setIsSubmitting(false)
                }
              })()
            }}
          />

          {error ? (
            <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          {packet ? (
            <AnswerPacketView packet={packet} onSelectCitation={setActiveAsset} />
          ) : (
            <section className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/80 p-6 text-sm leading-6 text-slate-400 shadow-xl shadow-slate-950/30">
              Ask a question to receive a grounded answer packet and supporting citations.
            </section>
          )}
        </div>

        <EvidenceViewer asset={activeAsset} />
      </div>
    </AppShell>
  )
}
