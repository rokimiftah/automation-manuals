// @vitest-environment jsdom

import "../../../test/setupDom"
import "@testing-library/jest-dom/vitest"

import { cleanup, render, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EngineerWorkspace from "./EngineerWorkspace"

const ask = vi.fn()

vi.mock("convex/react", () => ({
  useAction: () => ask
}))

vi.mock("@widgets/app-shell/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
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
    const user = userEvent.setup()
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

    const view = render(<EngineerWorkspace />)
    const textarea = view.getByRole("textbox")

    await user.type(textarea, "First question")
    await user.click(view.getByRole("button", { name: /find manuals/i }))

    await view.findByText("First answer")
    expect(ask).toHaveBeenNthCalledWith(1, {
      question: "First question",
      sessionAccessToken: undefined,
      sessionId: undefined
    })

    await user.type(textarea, "Follow-up question")
    await user.click(view.getByRole("button", { name: /find manuals/i }))

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
    expect(await view.findByText("Recovered answer")).toBeInTheDocument()
  })

  it("passes the prior interpreted problem when submitting a clarification follow-up", async () => {
    const user = userEvent.setup()
    ask
      .mockResolvedValueOnce({
        answerSummary: "Need vendor and model",
        answerSteps: [],
        answerabilityStatus: "needs_clarification",
        citations: [],
        interpretedProblem: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
        sessionAccessToken: "access-token-1",
        sessionId: "chatSessions_1",
        supportingAssets: []
      })
      .mockResolvedValueOnce({
        answerSummary: "Resolved F002 answer",
        answerSteps: [],
        answerabilityStatus: "grounded",
        citations: [],
        sessionAccessToken: "access-token-2",
        sessionId: "chatSessions_1",
        supportingAssets: []
      })

    const view = render(<EngineerWorkspace />)
    const textarea = view.getByRole("textbox")

    await user.type(textarea, "First question")
    await user.click(view.getByRole("button", { name: /find manuals/i }))

    await view.findByText("Need vendor and model")

    await user.type(textarea, "Follow-up question")
    await user.click(view.getByRole("button", { name: /find manuals/i }))

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
    expect(ask).toHaveBeenNthCalledWith(2, {
      previousInterpretedProblem: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
      question: "Follow-up question",
      sessionAccessToken: "access-token-1",
      sessionId: "chatSessions_1"
    })
    expect(await view.findByText("Resolved F002 answer")).toBeInTheDocument()
  })
})
