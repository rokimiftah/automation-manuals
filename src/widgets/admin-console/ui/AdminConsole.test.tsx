import type { ReactNode } from "react"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import AdminConsole from "./AdminConsole"

const createDocument = vi.fn()
const enqueue = vi.fn()
const retryJob = vi.fn()
const setDocumentActive = vi.fn()
const useMutation = vi.fn()
const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutation(...args),
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

vi.mock("@widgets/app-shell/ui/AppShell", () => ({
  default: ({ actions, children }: { actions?: ReactNode; children: ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  )
}))

vi.mock("@features/admin-ingestion/ui", () => ({
  DocumentRegistrationForm: ({ onSubmit }: { onSubmit: (values: Record<string, string>) => Promise<void> }) => (
    <button
      type="button"
      onClick={() =>
        void onSubmit({
          language: "English",
          productName: "GuardLogix 5570 Controllers",
          sourceUrl: "https://vendor.example/manual.pdf",
          title: "GuardLogix 5570 Controllers User Manual",
          vendorName: "Rockwell Automation",
          version: "20.01"
        }).catch(() => undefined)
      }
    >
      Queue document
    </button>
  ),
  IngestionJobList: ({ onRetry }: { onRetry: (jobId: never) => void | Promise<void> }) => (
    <button type="button" onClick={() => void onRetry("ingestionJobs_1" as never)}>
      Retry job
    </button>
  )
}))

describe("AdminConsole", () => {
  beforeEach(() => {
    createDocument.mockReset()
    enqueue.mockReset()
    retryJob.mockReset()
    setDocumentActive.mockReset()
    useMutation.mockReset()
    useQuery.mockReset()

    useQuery.mockReturnValue([])
    useMutation
      .mockReturnValueOnce(createDocument)
      .mockReturnValueOnce(enqueue)
      .mockReturnValueOnce(retryJob)
      .mockReturnValueOnce(setDocumentActive)
  })

  afterEach(() => {
    cleanup()
  })

  it("routes protected mutation auth failures through onSessionInvalid", async () => {
    createDocument.mockRejectedValue(new Error("Admin session expired"))
    const onSessionInvalid = vi.fn()

    render(<AdminConsole onSessionInvalid={onSessionInvalid} sessionToken="token-123" />)

    fireEvent.click(screen.getByRole("button", { name: /queue document/i }))

    await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledWith("Admin session expired. Please sign in again."))
  })

  it("does not expose session identity or sign-out controls in the admin shell", () => {
    render(<AdminConsole onSessionInvalid={vi.fn()} sessionToken="token-123" />)

    expect(screen.queryByText(/sign out admin/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^admin$/i)).not.toBeInTheDocument()
  })

  it("lets admins explicitly activate a ready document version", async () => {
    useQuery.mockReset()
    useQuery
      .mockReturnValueOnce([
        {
          _id: "documents_1",
          isActive: false,
          productSlug: "guardlogix-5570-controllers",
          status: "ready",
          title: "GuardLogix 5570 Controllers User Manual",
          vendorSlug: "rockwell-automation",
          version: "20.01"
        }
      ])
      .mockReturnValueOnce([])

    render(<AdminConsole onSessionInvalid={vi.fn()} sessionToken="token-123" />)

    fireEvent.click(screen.getByRole("button", { name: /set active 20\.01/i }))

    await waitFor(() =>
      expect(setDocumentActive).toHaveBeenCalledWith({
        documentId: "documents_1",
        isActive: true,
        sessionToken: "token-123"
      })
    )
  })
})
