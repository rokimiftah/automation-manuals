import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AppShell from "@widgets/app-shell/ui/AppShell"

import { DocumentRegistrationForm, IngestionJobList } from "@features/admin-ingestion/ui"
import { AuthGate, RoleGate } from "@features/auth/ui"

export default function AdminConsole() {
  const documents = useQuery(api.documents.listAdmin, {})
  const jobs = useQuery(api.ingestion.listJobs, {})
  const createDocument = useMutation(api.documents.create)
  const enqueue = useMutation(api.ingestion.enqueue)
  const retryJob = useMutation(api.ingestion.retry)

  return (
    <AuthGate>
      <RoleGate requiredRole="admin">
        <AppShell title="Admin Console">
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
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {documents === undefined ? "Loading registered manuals..." : "Documents available in the current workspace."}
                </p>
              </section>

              <DocumentRegistrationForm
                onSubmit={async (values) => {
                  const documentId = await createDocument(values)
                  await enqueue({ documentId })
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
                    void retryJob({ jobId })
                  }}
                />
              )}
            </div>
          </div>
        </AppShell>
      </RoleGate>
    </AuthGate>
  )
}
