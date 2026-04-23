import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { DocumentRegistrationForm, IngestionJobList } from "@features/admin-ingestion/ui"

function isAdminSessionError(error: unknown) {
  return error instanceof Error && /admin session/i.test(error.message)
}

export default function AdminConsole({
  onSessionInvalid,
  sessionToken
}: {
  onSessionInvalid: (message?: string) => void
  onSignOut: () => Promise<void>
  sessionToken: string
  username: string
}) {
  const documents = useQuery(api.documents.listAdmin, { sessionToken })
  const jobs = useQuery(api.ingestion.listJobs, { sessionToken })
  const createDocument = useMutation(api.documents.create)
  const enqueue = useMutation(api.ingestion.enqueue)
  const retryJob = useMutation(api.ingestion.retry)

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
                {documents === undefined ? "—" : documents.length}
              </p>
              <span className="mb-2 font-mono text-[14px] tracking-widest uppercase">Units</span>
            </div>
          </section>

          <div className="animate-expand flex min-h-0 flex-1 flex-col" style={{ animationDelay: "0.1s" }}>
            <div className="wire-border h-full min-h-0 overflow-y-auto bg-white">
              <DocumentRegistrationForm
                onSubmit={async (values) => {
                  await runProtectedMutation(async () => {
                    const documentId = await createDocument({ ...values, sessionToken })
                    await enqueue({ documentId, sessionToken })
                  })
                }}
              />
            </div>
          </div>
        </div>

        <div className="animate-expand flex min-h-0 flex-col lg:h-full" style={{ animationDelay: "0.2s" }}>
          {jobs === undefined ? (
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
              jobs={jobs}
              onRetry={(jobId) => {
                void runProtectedMutation(() => retryJob({ jobId, sessionToken }))
              }}
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}
