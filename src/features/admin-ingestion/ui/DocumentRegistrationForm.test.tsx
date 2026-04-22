import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import DocumentRegistrationForm from "./DocumentRegistrationForm"

const onSubmit = vi.fn()

describe("DocumentRegistrationForm", () => {
  it("requires source URL and title before submit", () => {
    render(<DocumentRegistrationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole("button", { name: /queue document/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Title and source URL are required.")
  })
})
