import type { Id } from "@convex/_generated/dataModel"
import type { ReactNode } from "react"

import { Component, useEffect } from "react"

import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { DocumentRegistrationForm, IngestionJobList } from "@features/admin-ingestion/ui"

function isAdminSessionError(error: unknown) {
  return error instanceof Error && /admin session/i.test(error.message)
}

class AdminConsoleQueryBoundary extends Component<{
  children: ReactNode
  onSessionInvalid: (message?: string) => void
}> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (isAdminSessionError(error)) {
      this.props.onSessionInvalid("Admin session expired. Please sign in again.")
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    if (isAdminSessionError(this.state.error)) {
      return null
    }

    throw this.state.error
  }
}

function AdminConsoleContent({
  onSessionInvalid,
  sessionToken
}: {
  onSessionInvalid: (message?: string) => void
  sessionToken: string
}) {
  const documents = useQuery(api.documents.listAdmin, { sessionToken })
  const jobs = useQuery(api.ingestion.listJobs, { sessionToken })
  const generateSourceUploadUrl = useMutation(api.documents.generateSourceUploadUrl)
  const createDocument = useMutation(api.documents.create)
  const enqueue = useMutation(api.ingestion.enqueue)
  const recoverStuckJob = useMutation(api.ingestion.recoverStuckJob)
  const retryJob = useMutation(api.ingestion.retry)
  const deleteDocument = useMutation(api.documents.deleteDocument)

  useEffect(() => {
    const queryError = [documents, jobs].find((result) => result instanceof Error)
    if (queryError && isAdminSessionError(queryError)) {
      onSessionInvalid("Admin session expired. Please sign in again.")
    }
  }, [documents, jobs, onSessionInvalid])

  const safeDocuments = documents instanceof Error ? undefined : documents
  const safeJobs = jobs instanceof Error ? undefined : jobs

  async function runProtectedMutation<T>(work: () => Promise<T>) {
    try {
      return await work()
    } catch (error) {
      if (isAdminSessionError(error)) {
        onSessionInvalid("Admin session expired. Please sign in again.")
      }

      throw error
    }
  }

  async function uploadSourceFile(sourceFile: File) {
    const uploadUrl = await generateSourceUploadUrl({ sessionToken })
    const response = await fetch(uploadUrl, {
      body: sourceFile,
      headers: { "Content-Type": sourceFile.type || "application/pdf" },
      method: "POST"
    })

    if (!response.ok) {
      throw new Error(`Source upload failed with status ${response.status}`)
    }

    const payload = (await response.json()) as { storageId?: string }
    const storageId = payload.storageId?.trim()
    if (!storageId) {
      throw new Error("Source upload did not return a storage ID")
    }

    return storageId as Id<"_storage">
  }

  return (
    <AppShell title="Admin Interface">
      <div className="grid h-full min-h-0 gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex h-full min-h-0 flex-col gap-4 md:gap-6">
          <section className="wire-border animate-expand relative flex shrink-0 flex-col justify-between gap-8 bg-white p-6 md:p-8">
            <div className="space-y-2">
              <h2 className="text-[20px] font-medium tracking-tight text-[#000000] uppercase md:text-[24px]">Manual Inventory</h2>
            </div>
            <div className="flex items-end gap-4">
              <p className="text-6xl leading-none font-medium tracking-tighter text-[#000000] md:text-8xl">
                {safeDocuments === undefined ? "—" : safeDocuments.length}
              </p>
              <span className="mb-2 font-mono text-[14px] tracking-widest uppercase">Units</span>
            </div>
          </section>

          <section
            className="wire-border animate-expand relative flex shrink-0 flex-col bg-white"
            style={{ animationDelay: "0.05s" }}
          >
            <div className="wire-border-b flex items-center justify-between bg-[#FAFAFA] p-6 md:p-8">
              <h2 className="text-[20px] font-medium tracking-tight text-[#000000] uppercase">Searchable Manuals</h2>
            </div>
            <div className="flex flex-col gap-4 p-6 md:p-8">
              {safeDocuments === undefined ? (
                <div className="crosshatch-bg wire-border h-24 animate-pulse" />
              ) : safeDocuments.length === 0 ? (
                <div className="wire-border border-dashed bg-[#FAFAFA] p-6 text-center font-mono text-[11px] tracking-[0.2em] uppercase">
                  No manuals registered
                </div>
              ) : (
                safeDocuments.map((document) => {
                  return (
                    <article key={document._id} className="wire-border flex flex-col gap-4 bg-white p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <h3 className="text-[14px] font-medium tracking-wide uppercase">{document.title}</h3>
                          <p className="font-mono text-[11px] tracking-widest text-[#555555] uppercase">
                            {document.vendorSlug} / {document.productSlug} / {document.version}
                          </p>
                        </div>
                        <span className="wire-border px-3 py-1 font-mono text-[10px] tracking-widest uppercase">
                          {document.status}
                        </span>
                      </div>
                      <div className="flex justify-end">
                        <button
                          className="wire-border px-4 py-2 font-mono text-[10px] tracking-widest uppercase transition-colors hover:bg-[#991b1b] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          type="button"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Delete ${document.title} ${document.version}? This will permanently remove the document, related history, and storage.`
                              )
                            ) {
                              return
                            }

                            try {
                              await runProtectedMutation(() => deleteDocument({ documentId: document._id, sessionToken }))
                            } catch (error) {
                              if (!isAdminSessionError(error)) {
                                window.alert(error instanceof Error ? error.message : "Unable to delete document.")
                              }
                            }
                          }}
                        >
                          Delete {document.version}
                        </button>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>

          <div className="animate-expand flex min-h-0 flex-1 flex-col" style={{ animationDelay: "0.1s" }}>
            <div className="wire-border h-full min-h-0 overflow-y-auto bg-white">
              <DocumentRegistrationForm
                onSubmit={async (values) => {
                  await runProtectedMutation(async () => {
                    const sourceFile = values.sourceFile
                    if (!sourceFile) {
                      throw new Error("Source PDF is required.")
                    }

                    const sourceStorageId = await uploadSourceFile(sourceFile)
                    const documentId = await createDocument({
                      language: values.language,
                      productName: values.productName,
                      sessionToken,
                      sourceStorageId,
                      title: values.title,
                      vendorName: values.vendorName,
                      version: values.version
                    })
                    await enqueue({
                      documentId,
                      sessionToken,
                      sourceFileName: sourceFile.name,
                      sourceMimeType: sourceFile.type || "application/pdf",
                      sourceStorageId
                    })
                  })
                }}
              />
            </div>
          </div>
        </div>

        <div className="animate-expand flex min-h-0 flex-col lg:h-full" style={{ animationDelay: "0.2s" }}>
          {safeJobs === undefined ? (
            <section className="wire-border relative flex h-full flex-col overflow-hidden bg-white">
              <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-6 md:p-8">
                <div className="space-y-1">
                  <h2 className="text-[20px] font-medium tracking-tight text-[#000000] uppercase">Ingestion Flow</h2>
                </div>
                <span className="wire-border px-3 py-1 font-mono text-[10px] font-medium tracking-widest text-[#000000] uppercase">
                  Loading...
                </span>
              </div>
              <div className="min-h-0 flex-1 bg-white p-6 md:p-8">
                <div className="crosshatch-bg wire-border h-full w-full animate-pulse" />
              </div>
            </section>
          ) : (
            <IngestionJobList
              jobs={safeJobs}
              onRecover={async (jobId) => {
                try {
                  await runProtectedMutation(() => recoverStuckJob({ jobId, sessionToken }))
                } catch (error) {
                  if (!isAdminSessionError(error)) {
                    window.alert(error instanceof Error ? error.message : "Unable to recover ingestion job.")
                  }
                }
              }}
              onRetry={async (jobId) => {
                try {
                  await runProtectedMutation(() => retryJob({ jobId, sessionToken }))
                } catch (error) {
                  if (!isAdminSessionError(error)) {
                    window.alert(error instanceof Error ? error.message : "Unable to retry ingestion job.")
                  }
                }
              }}
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default function AdminConsole({
  onSessionInvalid,
  sessionToken
}: {
  onSessionInvalid: (message?: string) => void
  sessionToken: string
}) {
  return (
    <AdminConsoleQueryBoundary key={sessionToken} onSessionInvalid={onSessionInvalid}>
      <AdminConsoleContent onSessionInvalid={onSessionInvalid} sessionToken={sessionToken} />
    </AdminConsoleQueryBoundary>
  )
}
