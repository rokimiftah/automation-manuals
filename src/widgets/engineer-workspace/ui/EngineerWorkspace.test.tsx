// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EngineerWorkspace from "./EngineerWorkspace"

const ask = vi.fn()

vi.mock("convex/react", () => ({
  useAction: () => ask
}))

vi.mock("@widgets/app-shell/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock("@features/ask-assistant/ui", () => ({
  AnswerPacketView: ({ packet }: { packet: { answerSummary: string } }) => <div>{packet.answerSummary}</div>,
  QuestionComposer: ({ disabled, onSubmit }: { disabled?: boolean; onSubmit: (question: string) => Promise<void> | void }) => (
    <div>
      <button disabled={disabled} type="button" onClick={() => void onSubmit("First question")}>
        Ask first
      </button>
      <button disabled={disabled} type="button" onClick={() => void onSubmit("Follow-up question")}>
        Ask follow up
      </button>
    </div>
  )
}))

vi.mock("@features/view-evidence/ui", () => ({
  default: ({ asset }: { asset: { label: string } | null }) => <div>{asset?.label ?? "No evidence"}</div>
}))

describe("EngineerWorkspace", () => {
  beforeEach(() => {
    ask.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it("retries once with a fresh session when the previous session is missing", async () => {
    ask
      .mockResolvedValueOnce({
        answerSummary: "First answer",
        answerSteps: [],
        answerabilityStatus: "grounded",
        citations: [],
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1",
        supportingAssets: []
      })
      .mockRejectedValueOnce(new Error("Session not found"))
      .mockResolvedValueOnce({
        answerSummary: "Recovered answer",
        answerSteps: [],
        answerabilityStatus: "grounded",
        citations: [],
        sessionAccessToken: "access-token-2",
        sessionId: "chatSessions_2",
        supportingAssets: []
      })

    render(<EngineerWorkspace />)

    fireEvent.click(screen.getByRole("button", { name: /ask first/i }))

    await screen.findByText("First answer")
    expect(ask).toHaveBeenNthCalledWith(1, {
      question: "First question",
      sessionAccessToken: undefined,
      sessionId: undefined
    })

    fireEvent.click(screen.getByRole("button", { name: /ask follow up/i }))

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(3))
    expect(ask).toHaveBeenNthCalledWith(2, {
      question: "Follow-up question",
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1"
    })
    expect(ask).toHaveBeenNthCalledWith(3, {
      question: "Follow-up question",
      sessionAccessToken: undefined,
      sessionId: undefined
    })
    expect(await screen.findByText("Recovered answer")).toBeInTheDocument()
  })
})
