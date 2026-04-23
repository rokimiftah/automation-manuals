import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import DocumentRegistrationForm from "./DocumentRegistrationForm"

const onSubmit = vi.fn()

describe("DocumentRegistrationForm", () => {
  it("requires every backend-mandated field before submit", () => {
    render(<DocumentRegistrationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole("button", { name: /enqueue data/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("Validation Err: Incomplete parameters.")).toBeInTheDocument()
  })
})
