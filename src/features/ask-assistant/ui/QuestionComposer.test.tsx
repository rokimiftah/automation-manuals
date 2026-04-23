// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import QuestionComposer from "./QuestionComposer"

afterEach(() => {
  cleanup()
})

describe("QuestionComposer", () => {
  it("keeps the draft question when submit fails", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error("Network error"))

    render(<QuestionComposer onSubmit={onSubmit} />)

    const textarea = screen.getByRole("textbox", { name: /question/i })

    await user.type(textarea, "How should I wire the stop input?")
    await user.click(screen.getByRole("button", { name: /ask assistant/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("How should I wire the stop input?"))
    expect(textarea).toHaveValue("How should I wire the stop input?")
  })

  it("clears the draft question after a successful submit", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(<QuestionComposer onSubmit={onSubmit} />)

    const textarea = screen.getByRole("textbox", { name: /question/i })

    await user.type(textarea, "Show the relay wiring guidance")
    await user.click(screen.getByRole("button", { name: /ask assistant/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Show the relay wiring guidance"))
    await waitFor(() => expect(textarea).toHaveValue(""))
  })
})
