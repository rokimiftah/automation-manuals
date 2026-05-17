import type { Id } from "@convex/_generated/dataModel"

import { useEffect, useRef, useState } from "react"

const RECOVERY_REFRESH_INTERVAL_MS = 5_000

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
  recoverableAt?: number
  serverNow: number
  status: string
  updatedAt: number
}

type IngestionJobListProps = {
  jobs: IngestionJob[]
  onRecover: (jobId: Id<"ingestionJobs">) => void | Promise<void>
  onRetry: (jobId: Id<"ingestionJobs">) => void | Promise<void>
}

function statusClasses(status: string) {
  if (status === "failed") {
    return "text-[#000000] bg-white border-l-4 border-l-[#000000] wire-border"
  }

  if (status === "ready") {
    return "text-white bg-[#000000] wire-border"
  }

  return "text-[#000000] bg-[#FAFAFA] wire-border"
}

function statusLabel(status: string) {
  if (status === "waiting_provider") {
    return "Pending"
  }

  if (status === "processing_provider") {
    return "Parsing"
  }

  if (status === "downloading_result") {
    return "Fetching"
  }

  return status.charAt(0).toUpperCase() + status.slice(1)
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

function canRecoverJob(job: IngestionJob, approxServerNow: number) {
  return job.recoverableAt !== undefined && approxServerNow >= job.recoverableAt
}

export default function IngestionJobList({ jobs, onRecover, onRetry }: IngestionJobListProps) {
  const [clientNow, setClientNow] = useState(() => Date.now())
  const [clockAnchor, setClockAnchor] = useState(() => ({
    clientNow: Date.now(),
    serverNow: jobs[0]?.serverNow ?? Date.now()
  }))
  const [pendingActionKeys, setPendingActionKeys] = useState<Set<string>>(() => new Set())
  const pendingActionKeysRef = useRef(new Set<string>())

  useEffect(() => {
    const nextClientNow = Date.now()
    setClientNow(nextClientNow)
    setClockAnchor({
      clientNow: nextClientNow,
      serverNow: jobs[0]?.serverNow ?? nextClientNow
    })
  }, [jobs])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClientNow(Date.now())
    }, RECOVERY_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const approxServerNow = clockAnchor.serverNow + (clientNow - clockAnchor.clientNow)

  async function runJobAction(
    action: "recover" | "retry",
    jobId: Id<"ingestionJobs">,
    work: (jobId: Id<"ingestionJobs">) => void | Promise<void>
  ) {
    const actionKey = `${action}:${jobId}`
    if (pendingActionKeysRef.current.has(actionKey)) {
      return
    }

    pendingActionKeysRef.current.add(actionKey)
    setPendingActionKeys(new Set(pendingActionKeysRef.current))

    try {
      await work(jobId)
    } finally {
      pendingActionKeysRef.current.delete(actionKey)
      setPendingActionKeys(new Set(pendingActionKeysRef.current))
    }
  }

  return (
    <section className="wire-border relative flex h-full flex-col overflow-hidden bg-white">
      <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-6">
        <div className="space-y-1">
          <h2 className="text-[20px] font-medium tracking-tight text-[#000000] uppercase">Ingestion Flow</h2>
        </div>
        <span className="wire-border bg-white px-4 py-2 font-mono text-[12px] font-medium tracking-widest text-[#000000] uppercase">
          {jobs.length} Nodes
        </span>
      </div>

      <div className="flex-1 overflow-auto bg-white p-6">
        {jobs.length === 0 ? (
          <div className="wire-border flex h-full flex-col items-center justify-center border-dashed bg-[#FAFAFA] p-12 text-center">
            <p className="font-mono text-[12px] tracking-[0.2em] text-[#000000] uppercase">Queue Empty</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {jobs.map((job) => {
              const recoverActionKey = `recover:${job._id}`
              const retryActionKey = `retry:${job._id}`
              const isRecoverPending = pendingActionKeys.has(recoverActionKey)
              const isRetryPending = pendingActionKeys.has(retryActionKey)

              return (
                <article
                  key={job._id}
                  className="wire-border relative flex flex-col justify-between gap-6 bg-white p-6 transition-colors hover:bg-[#FAFAFA] sm:flex-row sm:items-start"
                >
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate font-mono text-[14px] font-bold text-[#000000]">
                        D_{job.documentId.slice(0, 8)}...
                      </span>
                      <span
                        className={`shrink-0 px-3 py-1.5 font-mono text-[10px] font-medium tracking-widest uppercase ${statusClasses(job.status)}`}
                      >
                        {statusLabel(job.status)}
                      </span>
                    </div>

                    <div className="wire-border-t grid gap-x-8 gap-y-2 pt-4 font-mono text-[11px] tracking-widest text-[#000000] uppercase sm:grid-cols-2">
                      {job.providerState && <div>State: {job.providerState}</div>}
                      {job.providerErrorCode !== undefined && <div>Code: {job.providerErrorCode}</div>}
                      {job.providerLastCheckedAt !== undefined && (
                        <div className="sm:col-span-2">Ping: {new Date(job.providerLastCheckedAt).toLocaleTimeString()}</div>
                      )}
                    </div>

                    {job.errorMessage ? (
                      <div className="wire-border-t mt-4 pt-4">
                        <p className="wire-border flex items-start gap-3 bg-[#FAFAFA] p-3 font-mono text-[12px] text-[#000000]">
                          <span className="bg-[#000000] px-1.5 text-white">Err</span> {job.errorMessage}
                        </p>
                      </div>
                    ) : null}
                    {job.providerErrorMessage ? (
                      <div className="mt-2">
                        <p className="wire-border flex items-start gap-3 bg-[#FAFAFA] p-3 font-mono text-[12px] text-[#000000]">
                          <span className="bg-[#000000] px-1.5 text-white">Prv</span> {job.providerErrorMessage}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {canRecoverJob(job, approxServerNow) ? (
                    <button
                      className="wire-border w-full shrink-0 bg-white px-6 py-2.5 font-mono text-[11px] font-medium tracking-widest text-[#000000] uppercase transition-colors hover:bg-[#000000] hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      disabled={isRecoverPending}
                      type="button"
                      onClick={() => {
                        void runJobAction("recover", job._id, onRecover)
                      }}
                    >
                      {isRecoverPending ? "[ Recovering... ]" : "[ Recover ]"}
                    </button>
                  ) : null}

                  {canRetryJob(job, jobs) ? (
                    <button
                      className="wire-border w-full shrink-0 bg-white px-6 py-2.5 font-mono text-[11px] font-medium tracking-widest text-[#000000] uppercase transition-colors hover:bg-[#000000] hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      disabled={isRetryPending}
                      type="button"
                      onClick={() => {
                        void runJobAction("retry", job._id, onRetry)
                      }}
                    >
                      {isRetryPending ? "[ Retrying... ]" : "[ Retry ]"}
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
