export type MineruBatchState = "converting" | "done" | "failed" | "pending" | "running" | "waiting-file"

export type MineruBatchResultItem = {
  dataId?: string
  errorCode?: number
  errorMessage?: string
  fileName: string
  resultUrl?: string
  state: MineruBatchState
}

export type MineruBatchResult = {
  batchId: string
  results: MineruBatchResultItem[]
  traceId?: string
}
