import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import DocumentRegistrationForm from "./DocumentRegistrationForm"

const onSubmit = vi.fn()

describe("DocumentRegistrationForm", () => {
  beforeEach(() => {
    onSubmit.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it("requires every backend-mandated field before submit", () => {
    render(<DocumentRegistrationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole("button", { name: /enqueue data/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("Validation Err: Incomplete parameters.")).toBeInTheDocument()
  })

  it("submits the selected source pdf", async () => {
    render(<DocumentRegistrationForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/manufacturer/i), {
      target: { value: "Rockwell Automation" }
    })
    fireEvent.change(screen.getByLabelText(/apparatus/i), {
      target: { value: "GuardLogix 5570 Controllers" }
    })
    fireEvent.change(screen.getByLabelText(/document title/i), {
      target: { value: "GuardLogix 5570 Controllers User Manual" }
    })
    fireEvent.change(screen.getByLabelText(/edition/i), {
      target: { value: "20.01" }
    })
    fireEvent.change(screen.getByLabelText(/dialect/i), {
      target: { value: "English" }
    })

    const sourceFile = new File(["%PDF-1.4"], "manual.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText(/source pdf/i), {
      target: { files: [sourceFile] }
    })

    fireEvent.click(screen.getByRole("button", { name: /enqueue data/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          language: "English",
          productName: "GuardLogix 5570 Controllers",
          sourceFile,
          title: "GuardLogix 5570 Controllers User Manual",
          vendorName: "Rockwell Automation",
          version: "20.01"
        })
      )
    })
  })

  it("disables editable fields while submit is pending", async () => {
    let resolveSubmit: (() => void) | undefined
    onSubmit.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSubmit = resolve
      })
    )
    render(<DocumentRegistrationForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/manufacturer/i), {
      target: { value: "Rockwell Automation" }
    })
    fireEvent.change(screen.getByLabelText(/apparatus/i), {
      target: { value: "GuardLogix 5570 Controllers" }
    })
    fireEvent.change(screen.getByLabelText(/document title/i), {
      target: { value: "GuardLogix 5570 Controllers User Manual" }
    })
    fireEvent.change(screen.getByLabelText(/edition/i), {
      target: { value: "20.01" }
    })
    fireEvent.change(screen.getByLabelText(/dialect/i), {
      target: { value: "English" }
    })
    fireEvent.change(screen.getByLabelText(/source pdf/i), {
      target: { files: [new File(["%PDF-1.4"], "manual.pdf", { type: "application/pdf" })] }
    })

    fireEvent.click(screen.getByRole("button", { name: /enqueue data/i }))

    await waitFor(() => expect(screen.getByLabelText(/manufacturer/i)).toBeDisabled())
    expect(screen.getByLabelText(/apparatus/i)).toBeDisabled()
    expect(screen.getByLabelText(/document title/i)).toBeDisabled()
    expect(screen.getByLabelText(/edition/i)).toBeDisabled()
    expect(screen.getByLabelText(/dialect/i)).toBeDisabled()
    expect(screen.getByLabelText(/source pdf/i)).toBeDisabled()

    resolveSubmit?.()
  })
})
