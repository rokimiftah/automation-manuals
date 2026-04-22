export type IngestionStatus =
  | "queued"
  | "downloading"
  | "parsing"
  | "normalizing"
  | "embedding"
  | "ready"
  | "failed"

const ALLOWED_NEXT: Record<IngestionStatus, IngestionStatus[]> = {
  queued: ["downloading", "failed"],
  downloading: ["parsing", "failed"],
  parsing: ["normalizing", "failed"],
  normalizing: ["embedding", "failed"],
  embedding: ["ready", "failed"],
  ready: [],
  failed: ["queued"]
}

export function assertNextIngestionStatus(current: IngestionStatus, next: IngestionStatus) {
  if (!ALLOWED_NEXT[current].includes(next)) {
    throw new Error(`Invalid ingestion status transition: ${current} -> ${next}`)
  }
}
