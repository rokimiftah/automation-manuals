import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { DocumentRegistrationForm, IngestionJobList } from "@features/admin-ingestion/ui"

function isAdminSessionError(error: unknown) {
  return error instanceof Error && /admin session/i.test(error.message)
}

export default function AdminConsole({
  onSessionInvalid,
  onSignOut,
  sessionToken,
  username
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
    <AppShell
      title="Admin Console"
      actions={
        <>
          <span className="text-sm text-slate-400">Signed in as {username}</span>
          <button
            className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
            type="button"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Document inventory</p>
              <h2 className="text-2xl font-semibold text-white">Registered manuals</h2>
              <p className="text-sm leading-6 text-slate-400">Approved source documents ready for ingestion and retrieval.</p>
            </div>
            <p className="mt-5 font-mono text-4xl font-semibold tracking-tight text-white">
              {documents === undefined ? "—" : documents.length}
            </p>
          </section>

          <DocumentRegistrationForm
            onSubmit={async (values) => {
              await runProtectedMutation(async () => {
                const documentId = await createDocument({ ...values, sessionToken })
                await enqueue({ documentId, sessionToken })
              })
            }}
          />
        </div>

        <div className="space-y-6">
          {jobs === undefined ? (
            <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Ingestion jobs</p>
                <h2 className="text-2xl font-semibold text-white">Queue status</h2>
                <p className="text-sm leading-6 text-slate-400">Loading job history...</p>
              </div>
              <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-950/60" />
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
