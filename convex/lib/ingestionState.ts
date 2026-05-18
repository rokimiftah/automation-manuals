export type IngestionStatus =
  | "queued"
  | "downloading"
  | "submitting"
  | "waiting_provider"
  | "processing_provider"
  | "downloading_result"
  | "normalizing"
  | "embedding"
  | "embedding_waiting_rate_limit"
  | "ready"
  | "failed"

const ALLOWED_NEXT: Record<IngestionStatus, IngestionStatus[]> = {
  queued: ["downloading", "failed"],
  downloading: ["submitting", "failed"],
  submitting: ["waiting_provider", "processing_provider", "failed"],
  waiting_provider: ["processing_provider", "downloading_result", "failed"],
  processing_provider: ["downloading_result", "failed"],
  downloading_result: ["normalizing", "failed"],
  normalizing: ["embedding", "failed"],
  embedding: ["embedding_waiting_rate_limit", "ready", "failed"],
  embedding_waiting_rate_limit: ["embedding", "failed"],
  ready: [],
  failed: ["queued"]
}

export function assertNextIngestionStatus(current: IngestionStatus, next: IngestionStatus) {
  if (!ALLOWED_NEXT[current].includes(next)) {
    throw new Error(`Invalid ingestion status transition: ${current} -> ${next}`)
  }
}
