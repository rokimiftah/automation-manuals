import type { DocumentFormValues } from "@features/admin-ingestion/ui"
import type { ReactNode } from "react"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import AdminConsole from "./AdminConsole"

const fetchMock = vi.fn()
const createDocument = vi.fn()
const enqueue = vi.fn()
const generateSourceUploadUrl = vi.fn()
const deleteDocument = vi.fn()
const prepareMineruUpload = vi.fn()
const retryJob = vi.fn()
const useAction = vi.fn()
const useMutation = vi.fn()
const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useAction(...args),
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
  DocumentRegistrationForm: ({ onSubmit }: { onSubmit: (values: DocumentFormValues) => Promise<void> }) => (
    <button
      type="button"
      onClick={() =>
        void onSubmit({
          language: "English",
          productName: "GuardLogix 5570 Controllers",
          sourceFile: new File(["%PDF-1.4"], "manual.pdf", { type: "application/pdf" }),
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
    fetchMock.mockReset()
    generateSourceUploadUrl.mockReset()
    deleteDocument.mockReset()
    prepareMineruUpload.mockReset()
    retryJob.mockReset()
    useAction.mockReset()
    useMutation.mockReset()
    useQuery.mockReset()

    useQuery.mockReturnValue([])
    useMutation
      .mockReturnValueOnce(generateSourceUploadUrl)
      .mockReturnValueOnce(createDocument)
      .mockReturnValueOnce(enqueue)
      .mockReturnValueOnce(retryJob)
      .mockReturnValueOnce(deleteDocument)
    useAction.mockReturnValue(prepareMineruUpload)

    vi.stubGlobal("fetch", fetchMock)
    generateSourceUploadUrl.mockResolvedValue("https://upload.example/source")
    prepareMineruUpload.mockResolvedValue({ batchId: "batch-1", traceId: "trace-1" })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("routes protected mutation auth failures through onSessionInvalid", async () => {
    createDocument.mockRejectedValue(new Error("Admin session expired"))
    const onSessionInvalid = vi.fn()

    render(<AdminConsole onSessionInvalid={onSessionInvalid} sessionToken="token-123" />)

    fireEvent.click(screen.getByRole("button", { name: /queue document/i }))

    await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledWith("Admin session expired. Please sign in again."))
  })

  it("uploads the source file and prepares the mineru batch before queueing ingestion", async () => {
    createDocument.mockResolvedValue("documents_1")
    enqueue.mockResolvedValue("ingestionJobs_1")

    render(<AdminConsole onSessionInvalid={vi.fn()} sessionToken="token-123" />)

    fireEvent.click(screen.getByRole("button", { name: /queue document/i }))

    await waitFor(() => expect(generateSourceUploadUrl).toHaveBeenCalledWith({ sessionToken: "token-123" }))
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/source",
      expect.objectContaining({
        body: expect.any(File),
        method: "POST"
      })
    )
    await waitFor(() =>
      expect(prepareMineruUpload).toHaveBeenCalledWith({
        sourceStorageId: "storage_1",
        fileName: "manual.pdf",
        sessionToken: "token-123"
      })
    )
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "English",
        productName: "GuardLogix 5570 Controllers",
        sessionToken: "token-123",
        sourceStorageId: "storage_1",
        title: "GuardLogix 5570 Controllers User Manual",
        vendorName: "Rockwell Automation",
        version: "20.01"
      })
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "documents_1",
        providerBatchId: "batch-1",
        providerTraceId: "trace-1",
        sessionToken: "token-123",
        sourceFileName: "manual.pdf",
        sourceMimeType: "application/pdf",
        sourceStorageId: "storage_1"
      })
    )
  })

  it("does not expose session identity or sign-out controls in the admin shell", () => {
    render(<AdminConsole onSessionInvalid={vi.fn()} sessionToken="token-123" />)

    expect(screen.queryByText(/sign out admin/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^admin$/i)).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /searchable manuals/i })).toBeInTheDocument()
  })

  it("shows a ready document without activation controls", async () => {
    useQuery.mockReset()
    useQuery
      .mockReturnValueOnce([
        {
          _id: "documents_1",
          productSlug: "guardlogix-5570-controllers",
          status: "ready",
          title: "GuardLogix 5570 Controllers User Manual",
          vendorSlug: "rockwell-automation",
          version: "20.01"
        }
      ])
      .mockReturnValueOnce([])

    render(<AdminConsole onSessionInvalid={vi.fn()} sessionToken="token-123" />)

    expect(screen.getByRole("heading", { name: /guardlogix 5570 controllers user manual/i })).toBeInTheDocument()
    expect(screen.getByText("ready")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /delete 20\.01/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /set active/i })).not.toBeInTheDocument()
  })

  it("deletes a ready document after confirmation", async () => {
    useQuery.mockReset()
    useQuery
      .mockReturnValueOnce([
        {
          _id: "documents_1",
          productSlug: "guardlogix-5570-controllers",
          status: "ready",
          title: "GuardLogix 5570 Controllers User Manual",
          vendorSlug: "rockwell-automation",
          version: "20.01"
        }
      ])
      .mockReturnValueOnce([])

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true))

    render(<AdminConsole onSessionInvalid={vi.fn()} sessionToken="token-123" />)

    fireEvent.click(screen.getByRole("button", { name: /delete 20\.01/i }))

    await waitFor(() =>
      expect(deleteDocument).toHaveBeenCalledWith({
        documentId: "documents_1",
        sessionToken: "token-123"
      })
    )
  })
})
