import type { Id } from "@convex/_generated/dataModel"

export type IngestionJob = {
  _creationTime: number
  _id: Id<"ingestionJobs">
  createdAt: number
  documentId: Id<"documents">
  errorMessage?: string
  providerErrorCode?: number
  providerErrorMessage?: string
  providerLastCheckedAt?: number
  providerState?: string
  status: string
}

type IngestionJobListProps = {
  jobs: IngestionJob[]
  onRetry: (jobId: Id<"ingestionJobs">) => void | Promise<void>
}

function statusClasses(status: string) {
  if (status === "failed") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200"
  }

  if (status === "ready") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  }

  return "border-slate-700 bg-slate-950 text-slate-300"
}

function statusLabel(status: string) {
  if (status === "waiting_provider") {
    return "Waiting on MinerU queue"
  }

  if (status === "processing_provider") {
    return "MinerU is processing"
  }

  if (status === "downloading_result") {
    return "Importing MinerU result"
  }

  return status
}

function compareJobRecency(left: IngestionJob, right: IngestionJob) {
  if (left._creationTime !== right._creationTime) {
    return left._creationTime - right._creationTime
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  return String(left._id).localeCompare(String(right._id))
}

function canRetryJob(job: IngestionJob, jobs: IngestionJob[]) {
  if (job.status !== "failed") {
    return false
  }

  const latestDocumentJob = jobs.reduce<IngestionJob | null>((latest, candidate) => {
    if (candidate.documentId !== job.documentId) {
      return latest
    }

    if (!latest || compareJobRecency(candidate, latest) > 0) {
      return candidate
    }

    return latest
  }, null)

  return latestDocumentJob?._id === job._id
}

export default function IngestionJobList({ jobs, onRetry }: IngestionJobListProps) {
  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Ingestion jobs</p>
          <h2 className="text-2xl font-semibold text-white">Queue status</h2>
        </div>
        <p className="text-sm text-slate-400">
          <span className="font-mono text-slate-100">{jobs.length}</span> jobs
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-4 py-6 text-sm leading-6 text-slate-400">
          No ingestion jobs yet. Queue a document to start the pipeline.
        </div>
      ) : (
        <div className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800">
          {jobs.map((job) => (
            <article
              key={job._id}
              className="flex flex-col gap-4 bg-slate-950/40 px-4 py-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-medium text-white">
                    Document <span className="font-mono">{job.documentId}</span>
                  </p>
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.3em] uppercase ${statusClasses(job.status)}`}
                  >
                    {statusLabel(job.status)}
                  </span>
                </div>
                {job.errorMessage ? <p className="text-sm leading-6 text-rose-200">{job.errorMessage}</p> : null}
                {job.providerState ? (
                  <p className="text-xs tracking-[0.25em] text-slate-500 uppercase">Provider: {job.providerState}</p>
                ) : null}
                {job.providerErrorMessage ? <p className="text-sm leading-6 text-amber-200">{job.providerErrorMessage}</p> : null}
                {job.providerErrorCode !== undefined ? (
                  <p className="text-xs text-slate-500">Provider error code: {job.providerErrorCode}</p>
                ) : null}
                {job.providerLastCheckedAt !== undefined ? (
                  <p className="text-xs text-slate-500">Last checked: {new Date(job.providerLastCheckedAt).toLocaleString()}</p>
                ) : null}
              </div>

              {canRetryJob(job, jobs) ? (
                <button
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white active:translate-y-px"
                  type="button"
                  onClick={() => {
                    void onRetry(job._id)
                  }}
                >
                  Retry
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
