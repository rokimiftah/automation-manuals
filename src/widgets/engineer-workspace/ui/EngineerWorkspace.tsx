import type { Id } from "@convex/_generated/dataModel"
import type { SupportingAsset } from "@entities/knowledge/model/types"
import type { AnswerPacketViewPacket } from "@features/ask-assistant/ui"

import { startTransition, useState } from "react"

import { useAction } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { AnswerPacketView, QuestionComposer } from "@features/ask-assistant/ui"
import EvidenceViewer from "@features/view-evidence/ui"

function isMissingSessionError(error: unknown) {
  return error instanceof Error && /session not found/i.test(error.message)
}

export default function EngineerWorkspace() {
  const ask = useAction(api.search.ask)
  const [sessionAccessToken, setSessionAccessToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<Id<"chatSessions"> | null>(null)
  const [packet, setPacket] = useState<AnswerPacketViewPacket | null>(null)
  const [activeAsset, setActiveAsset] = useState<SupportingAsset | null>(null)
  const [error, setError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  type AskResult = AnswerPacketViewPacket & {
    sessionAccessToken: string
    sessionId: Id<"chatSessions">
  }

  return (
    <AppShell title="Engineer Workspace">
      <div className="mx-auto flex w-full max-w-450 flex-col gap-6 p-4 md:p-8 lg:h-full lg:min-h-0 lg:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-6 lg:h-full lg:min-h-0 lg:w-[45%]">
          <div className="animate-expand shrink-0" style={{ animationDelay: "0ms" }}>
            <QuestionComposer
              disabled={isSubmitting}
              onSubmit={(question) =>
                (async () => {
                  setError(undefined)
                  setIsSubmitting(true)

                  try {
                    let result: AskResult

                    try {
                      result = await ask({
                        question,
                        sessionAccessToken: sessionAccessToken ?? undefined,
                        sessionId: sessionId ?? undefined
                      })
                    } catch (submitError) {
                      if (!sessionId || !isMissingSessionError(submitError)) {
                        throw submitError
                      }

                      setSessionAccessToken(null)
                      setSessionId(null)
                      result = await ask({ question, sessionAccessToken: undefined, sessionId: undefined })
                    }

                    startTransition(() => {
                      setSessionAccessToken(result.sessionAccessToken)
                      setSessionId(result.sessionId)
                      setPacket(result)
                      setActiveAsset(result.supportingAssets[0] ?? null)
                    })
                  } catch (submitError) {
                    const error = submitError instanceof Error ? submitError : new Error("Unable to execute process.")
                    setError(error.message)
                    throw error
                  } finally {
                    setIsSubmitting(false)
                  }
                })()
              }
            />

            {error ? (
              <div className="wire-border relative mt-6 flex items-start gap-4 overflow-hidden bg-white p-4 font-mono text-[13px] text-[#000000]">
                <div className="diagonal-bg pointer-events-none absolute inset-0 opacity-20"></div>
                <span className="relative z-10 shrink-0 bg-[#000000] px-2 py-0.5 text-[10px] tracking-widest text-white uppercase">
                  ERR
                </span>
                <span className="relative z-10 leading-relaxed">{error}</span>
              </div>
            ) : null}
          </div>

          <div className="animate-expand flex min-h-75 flex-1 flex-col lg:min-h-0" style={{ animationDelay: "0.1s" }}>
            {packet ? (
              <div className="wire-border relative h-full min-h-0 overflow-y-auto bg-white shadow-sm">
                <AnswerPacketView packet={packet} onSelectCitation={setActiveAsset} />
              </div>
            ) : (
              <section className="wire-border relative flex h-full min-h-40 flex-col items-center justify-center border-dashed bg-[#FAFAFA] p-12 text-center">
                <div className="space-y-4">
                  <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-[#E5E5E5]" />
                  <p className="font-mono text-[11px] tracking-[0.2em] text-[#555555] uppercase">Awaiting Input...</p>
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="animate-expand flex min-h-100 flex-1 flex-col lg:h-full lg:min-h-0" style={{ animationDelay: "0.2s" }}>
          <EvidenceViewer asset={activeAsset} />
        </div>
      </div>
    </AppShell>
  )
}
