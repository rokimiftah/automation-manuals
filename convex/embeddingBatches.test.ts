import { getFunctionName } from "convex/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./lib/providerErrors"

const JINA_EMBEDDING_DIMENSIONS = 1024
const embedDocumentTexts = vi.fn()
const estimateJinaEmbeddingRequestCount = vi.fn((inputs: string[]) => Math.max(1, Math.ceil(inputs.length / 50)))
const getProviderEnv = vi.fn()

vi.mock("./lib/env", () => {
  return { getProviderEnv }
})

vi.mock("./lib/jina", () => {
  return {
    embedDocumentTexts,
    estimateJinaEmbeddingRequestCount,
    JINA_DOCUMENT_PREFIX: "Document: ",
    JINA_DOCUMENT_TASK: "retrieval.passage",
    JINA_EMBEDDING_DIMENSIONS,
    JINA_EMBEDDING_PROVIDER: "jina",
    JINA_QUERY_PREFIX: "Query: ",
    JINA_QUERY_TASK: "retrieval.query"
  }
})

const {
  claimNextBatch,
  completeJobIfAllBatchesDone,
  createBatchesForJob,
  markBatchCompleted,
  markBatchFailed,
  markBatchRateLimited,
  markBatchRetrying,
  processNextBatch
} = await import("./embeddingBatches")

type Id<TableName extends string> = `${TableName}_${number}` | `${TableName}_${string}`

type EmbeddingBatchStatus = "pending" | "processing" | "rate_limited" | "retrying" | "completed" | "failed"

type EmbeddingBatch = {
  _creationTime: number
  _id: Id<"embeddingBatches">
  attemptCount: number
  batchIndex: number
  chunkIds: Id<"chunks">[]
  createdAt: number
  documentId: Id<"documents">
  finalizedAt?: number
  jobId: Id<"ingestionJobs">
  lastErrorMessage?: string
  lastProviderKeyId?: string
  nextRunAt?: number
  status: EmbeddingBatchStatus
  updatedAt: number
}

type Chunk = {
  _creationTime: number
  _id: Id<"chunks">
  chunkType: "text"
  citationLabel: string
  content: string
  documentId: Id<"documents">
  ingestionJobId: Id<"ingestionJobs">
  isCurrent: boolean
  pageNumber: number
}

type ChunkEmbedding = {
  _creationTime: number
  _id: Id<"chunkEmbeddings">
  chunkId: Id<"chunks">
  isCurrent: boolean
}

type DocumentRow = {
  _creationTime: number
  _id: Id<"documents">
  status: "draft" | "processing" | "ready" | "failed" | "inactive"
  updatedAt: number
}

type IngestionJob = {
  _creationTime: number
  _id: Id<"ingestionJobs">
  createdAt: number
  documentId: Id<"documents">
  errorMessage?: string
  status:
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
  updatedAt: number
}

type Tables = {
  chunkEmbeddings: ChunkEmbedding[]
  chunks: Chunk[]
  documents: DocumentRow[]
  embeddingBatches: EmbeddingBatch[]
  ingestionJobs: IngestionJob[]
}

type QueryBuilder = {
  eq: (field: string, value: unknown) => QueryBuilder
}

type MutationArgs = Record<string, unknown>

const NOW = 1_700_000_000_000
const JOB_ID = "ingestionJobs_1" as Id<"ingestionJobs">
const DOCUMENT_ID = "documents_1" as Id<"documents">

const createBatchesForJobHandler = createBatchesForJob as typeof createBatchesForJob & {
  _handler: (
    ctx: unknown,
    args: { batchSize?: number; chunkIds: Id<"chunks">[]; documentId: Id<"documents">; jobId: Id<"ingestionJobs"> }
  ) => Promise<number>
}

const claimNextBatchHandler = claimNextBatch as typeof claimNextBatch & {
  _handler: (
    ctx: unknown,
    args: { documentId: Id<"documents">; jobId: Id<"ingestionJobs"> }
  ) => Promise<{
    attemptCount: number
    batchId: Id<"embeddingBatches">
    chunkIds: Id<"chunks">[]
    contents: string[]
  } | null>
}

const markBatchRateLimitedHandler = markBatchRateLimited as typeof markBatchRateLimited & {
  _handler: (
    ctx: unknown,
    args: {
      attemptCount?: number
      batchId: Id<"embeddingBatches">
      jobId: Id<"ingestionJobs">
      lastProviderKeyId?: string
      retryAfterMs: number
    }
  ) => Promise<null>
}

const markBatchCompletedHandler = markBatchCompleted as typeof markBatchCompleted & {
  _handler: (ctx: unknown, args: { attemptCount?: number; batchId: Id<"embeddingBatches"> }) => Promise<null>
}

const markBatchRetryingHandler = markBatchRetrying as typeof markBatchRetrying & {
  _handler: (
    ctx: unknown,
    args: { attemptCount?: number; batchId: Id<"embeddingBatches">; lastProviderKeyId?: string; retryAfterMs: number }
  ) => Promise<null>
}

const markBatchFailedHandler = markBatchFailed as typeof markBatchFailed & {
  _handler: (
    ctx: unknown,
    args: {
      attemptCount?: number
      batchId: Id<"embeddingBatches">
      documentId: Id<"documents">
      jobId: Id<"ingestionJobs">
      lastProviderKeyId?: string
    }
  ) => Promise<null>
}

const completeJobIfAllBatchesDoneHandler = completeJobIfAllBatchesDone as typeof completeJobIfAllBatchesDone & {
  _handler: (ctx: unknown, args: { documentId: Id<"documents">; jobId: Id<"ingestionJobs"> }) => Promise<boolean>
}

const processNextBatchHandler = processNextBatch as typeof processNextBatch & {
  _handler: (ctx: unknown, args: { documentId: Id<"documents">; jobId: Id<"ingestionJobs"> }) => Promise<null>
}

function createEmbedding(value = 0.1) {
  return Array.from({ length: JINA_EMBEDDING_DIMENSIONS }, () => value)
}

function createChunks(count: number, overrides: Partial<Chunk> = {}) {
  return Array.from({ length: count }, (_, index): Chunk => {
    const chunkId = `chunks_${index + 1}` as Id<"chunks">
    return {
      _creationTime: index + 1,
      _id: chunkId,
      chunkType: "text",
      citationLabel: `Page ${index + 1}`,
      content: `Chunk content ${index + 1}`,
      documentId: DOCUMENT_ID,
      ingestionJobId: JOB_ID,
      isCurrent: true,
      pageNumber: index + 1,
      ...overrides
    }
  })
}

function createBatch(overrides: Partial<EmbeddingBatch> = {}): EmbeddingBatch {
  return {
    _creationTime: 1,
    _id: "embeddingBatches_1",
    attemptCount: 0,
    batchIndex: 0,
    chunkIds: ["chunks_1", "chunks_2"],
    createdAt: NOW,
    documentId: DOCUMENT_ID,
    jobId: JOB_ID,
    status: "pending",
    updatedAt: NOW,
    ...overrides
  }
}

function createChunkEmbedding(chunkId: Id<"chunks">, overrides: Partial<ChunkEmbedding> = {}): ChunkEmbedding {
  return {
    _creationTime: 1,
    _id: `chunkEmbeddings_${chunkId}`,
    chunkId,
    isCurrent: true,
    ...overrides
  }
}

function createJob(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    _creationTime: 1,
    _id: JOB_ID,
    createdAt: NOW,
    documentId: DOCUMENT_ID,
    status: "embedding",
    updatedAt: NOW,
    ...overrides
  }
}

function createDocument(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    _creationTime: 1,
    _id: DOCUMENT_ID,
    status: "processing",
    updatedAt: NOW,
    ...overrides
  }
}

function createDb(initial: Partial<Tables> = {}) {
  const tables: Tables = {
    chunkEmbeddings: initial.chunkEmbeddings?.map((row) => ({ ...row })) ?? [],
    chunks: initial.chunks?.map((row) => ({ ...row })) ?? [],
    documents: initial.documents?.map((row) => ({ ...row })) ?? [createDocument()],
    embeddingBatches: initial.embeddingBatches?.map((row) => ({ ...row })) ?? [],
    ingestionJobs: initial.ingestionJobs?.map((row) => ({ ...row })) ?? [createJob()]
  }
  const insertedRows: Array<{ table: keyof Tables; value: unknown }> = []
  const patchedRows: Array<{ id: string; patch: Record<string, unknown>; table: keyof Tables }> = []
  const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")

  function tableForId(id: string): keyof Tables {
    if (id.startsWith("chunks_")) {
      return "chunks"
    }
    if (id.startsWith("chunkEmbeddings_")) {
      return "chunkEmbeddings"
    }
    if (id.startsWith("documents_")) {
      return "documents"
    }
    if (id.startsWith("embeddingBatches_")) {
      return "embeddingBatches"
    }
    if (id.startsWith("ingestionJobs_")) {
      return "ingestionJobs"
    }
    throw new Error(`Unknown id ${id}`)
  }

  const db = {
    get: vi.fn(async (tableOrId: keyof Tables | string, maybeId?: string) => {
      const table = maybeId === undefined ? tableForId(tableOrId) : (tableOrId as keyof Tables)
      const id = maybeId ?? tableOrId
      return tables[table].find((row) => row._id === id) ?? null
    }),
    insert: vi.fn(async (table: keyof Tables, value: Record<string, unknown>) => {
      const id = `${table}_${tables[table].length + 1}`
      const row = { _creationTime: NOW, _id: id, ...value } as never
      tables[table].push(row)
      insertedRows.push({ table, value: row })
      return id
    }),
    patch: vi.fn(async (table: keyof Tables, id: string, patch: Record<string, unknown>) => {
      const row = tables[table].find((candidate) => candidate._id === id)
      if (!row) {
        throw new Error(`Missing ${table} row ${id}`)
      }
      Object.assign(row, patch)
      patchedRows.push({ id, patch, table })
    }),
    query: vi.fn((table: keyof Tables) => ({
      withIndex: vi.fn((_index: string, buildRange: (q: QueryBuilder) => void) => {
        const filters: Array<[string, unknown]> = []
        const builder: QueryBuilder = {
          eq(field, value) {
            filters.push([field, value])
            return builder
          }
        }
        buildRange(builder)
        const matches = tables[table].filter((row) => filters.every(([field, value]) => row[field as keyof typeof row] === value))
        return {
          collect: vi.fn(async () => matches),
          take: vi.fn(async (count: number) => matches.slice(0, count)),
          unique: vi.fn(async () => matches[0] ?? null)
        }
      })
    }))
  }

  return { ctx: { db, scheduler: { runAfter } }, insertedRows, patchedRows, runAfter, tables }
}

function createActionCtx(options: {
  db: ReturnType<typeof createDb>
  insertEmbeddingsError?: Error
  markCompletedError?: Error
  recordProviderSuccessError?: Error
  reservation?: { available: false; retryAfterMs: number } | { available: true; keyId: string }
  reservationError?: Error
  scheduled?: ReturnType<typeof vi.fn>
}) {
  const runAfter = options.scheduled ?? vi.fn().mockResolvedValue("_scheduled_functions_1")
  const mutationCalls: MutationArgs[] = []
  const mutationFunctionNames: string[] = []
  const insertedEmbeddings: MutationArgs[] = []
  const disabledKeys: MutationArgs[] = []
  const failedDocuments: MutationArgs[] = []
  const providerSuccesses: MutationArgs[] = []
  const providerRateLimits: MutationArgs[] = []
  const providerTransientFailures: MutationArgs[] = []

  const runMutation = vi.fn(async (_reference: unknown, args: MutationArgs): Promise<unknown> => {
    mutationCalls.push(args)
    const functionName = getFunctionName(_reference as never)
    mutationFunctionNames.push(functionName)

    if (functionName === "providerRateLimits:reserveProviderKey") {
      if (options.reservationError) {
        throw options.reservationError
      }

      return options.reservation ?? { available: true, keyId: "jina:1" }
    }

    if (functionName === "providerRateLimits:disableProviderKey") {
      disabledKeys.push(args)
      return null
    }

    if (functionName === "providerRateLimits:recordProviderRateLimit") {
      providerRateLimits.push(args)
      return null
    }

    if (functionName === "providerRateLimits:recordProviderSuccess") {
      if (options.recordProviderSuccessError) {
        throw options.recordProviderSuccessError
      }

      providerSuccesses.push(args)
      return null
    }

    if (functionName === "providerRateLimits:recordProviderTransientFailure") {
      providerTransientFailures.push(args)
      return null
    }

    if (functionName === "documents:insertChunkEmbeddingsBatch") {
      if (options.insertEmbeddingsError) {
        throw options.insertEmbeddingsError
      }

      insertedEmbeddings.push(args)
      return Array.isArray(args.chunkIds) ? args.chunkIds.length : 0
    }

    if (functionName === "embeddingBatches:markBatchRateLimited") {
      return await markBatchRateLimitedHandler._handler(options.db.ctx as never, args as never)
    }

    if (functionName === "embeddingBatches:markBatchCompleted") {
      if (options.markCompletedError) {
        throw options.markCompletedError
      }

      return await markBatchCompletedHandler._handler(options.db.ctx as never, args as never)
    }

    if (functionName === "embeddingBatches:markBatchRetrying") {
      return await markBatchRetryingHandler._handler(options.db.ctx as never, args as never)
    }

    if (functionName === "embeddingBatches:markBatchFailed") {
      return await markBatchFailedHandler._handler({ ...options.db.ctx, runMutation } as never, args as never)
    }

    if (functionName === "documents:markFailed") {
      failedDocuments.push(args)
      const job = options.db.tables.ingestionJobs.find((candidate) => candidate._id === args.jobId)
      if (job) {
        Object.assign(job, {
          errorMessage: args.errorMessage,
          status: "failed",
          updatedAt: Date.now()
        })
      }

      const document = options.db.tables.documents.find((candidate) => candidate._id === args.documentId)
      if (document) {
        Object.assign(document, { status: "failed", updatedAt: Date.now() })
      }

      return null
    }

    if (functionName === "embeddingBatches:claimNextBatch") {
      return await claimNextBatchHandler._handler(options.db.ctx as never, args as never)
    }

    return null
  })

  return {
    ctx: {
      runMutation,
      scheduler: {
        runAfter
      }
    },
    disabledKeys,
    failedDocuments,
    insertedEmbeddings,
    mutationCalls,
    mutationFunctionNames,
    providerRateLimits,
    providerSuccesses,
    providerTransientFailures,
    runAfter,
    runMutation
  }
}

describe("embedding batch mutations", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date, "now").mockReturnValue(NOW)
  })

  it("splits chunk ids into pending batches of 50", async () => {
    const chunkIds = createChunks(120).map((chunk) => chunk._id)
    const db = createDb()

    const inserted = await createBatchesForJobHandler._handler(db.ctx as never, {
      chunkIds,
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })

    expect(inserted).toBe(3)
    expect(db.tables.embeddingBatches.map((batch) => batch.chunkIds.length)).toEqual([50, 50, 20])
    expect(db.tables.embeddingBatches.map((batch) => batch.batchIndex)).toEqual([0, 1, 2])
    expect(db.tables.embeddingBatches).toEqual(
      expect.arrayContaining([expect.objectContaining({ attemptCount: 0, createdAt: NOW, status: "pending", updatedAt: NOW })])
    )
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })
  })

  it("does not create duplicate rows for the same job", async () => {
    const existingBatch = createBatch()
    const db = createDb({ embeddingBatches: [existingBatch] })

    const inserted = await createBatchesForJobHandler._handler(db.ctx as never, {
      chunkIds: ["chunks_1", "chunks_2"],
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })

    expect(inserted).toBe(0)
    expect(db.tables.embeddingBatches).toEqual([existingBatch])
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })
  })

  it("claims due pending, retrying, and rate-limited rows", async () => {
    const claimableCases: Array<{ nextRunAt?: number; status: "pending" | "rate_limited" | "retrying" }> = [
      { status: "pending" },
      { nextRunAt: NOW, status: "retrying" },
      { nextRunAt: NOW - 1, status: "rate_limited" }
    ]

    for (const claimable of claimableCases) {
      const db = createDb({
        chunks: createChunks(2),
        embeddingBatches: [createBatch({ attemptCount: 2, chunkIds: ["chunks_2", "chunks_1"], ...claimable })]
      })

      const claimed = await claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

      expect(claimed).toEqual({
        attemptCount: 3,
        batchId: "embeddingBatches_1",
        chunkIds: ["chunks_2", "chunks_1"],
        contents: ["Chunk content 2", "Chunk content 1"]
      })
      expect(db.tables.embeddingBatches[0]).toMatchObject({
        attemptCount: 3,
        nextRunAt: undefined,
        status: "processing",
        updatedAt: NOW
      })
      expect(db.patchedRows).toContainEqual({
        id: "embeddingBatches_1",
        patch: {
          attemptCount: 3,
          nextRunAt: undefined,
          status: "processing",
          updatedAt: NOW
        },
        table: "embeddingBatches"
      })
      expect(db.runAfter).toHaveBeenCalledWith(5 * 60 * 1000 + 1, expect.anything(), {
        documentId: DOCUMENT_ID,
        jobId: JOB_ID
      })
    }
  })

  it("skips future rate-limited, completed, and failed rows when claiming", async () => {
    const db = createDb({
      chunks: createChunks(2),
      embeddingBatches: [
        createBatch({ _id: "embeddingBatches_1", batchIndex: 0, nextRunAt: NOW + 1, status: "rate_limited" }),
        createBatch({ _id: "embeddingBatches_2", batchIndex: 1, status: "completed" }),
        createBatch({ _id: "embeddingBatches_3", batchIndex: 2, status: "failed" }),
        createBatch({ _id: "embeddingBatches_4", attemptCount: 1, batchIndex: 3, status: "retrying" })
      ]
    })

    const claimed = await claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(claimed).toMatchObject({ attemptCount: 2, batchId: "embeddingBatches_4" })
    expect(db.tables.embeddingBatches[0]).toMatchObject({ nextRunAt: NOW + 1, status: "rate_limited" })
    expect(db.tables.embeddingBatches[1]).toMatchObject({ status: "completed" })
    expect(db.tables.embeddingBatches[2]).toMatchObject({ status: "failed" })
    expect(db.tables.embeddingBatches[3]).toMatchObject({ attemptCount: 2, status: "processing" })
  })

  it("reclaims processing rows whose lease is stale", async () => {
    const db = createDb({
      chunks: createChunks(2),
      embeddingBatches: [createBatch({ attemptCount: 1, status: "processing", updatedAt: NOW - 5 * 60 * 1000 - 1 })]
    })

    const claimed = await claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(claimed).toMatchObject({
      attemptCount: 2,
      batchId: "embeddingBatches_1",
      contents: ["Chunk content 1", "Chunk content 2"]
    })
    expect(db.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 2, status: "processing", updatedAt: NOW })
  })

  it("skips processing rows whose lease is still fresh", async () => {
    const db = createDb({
      chunks: createChunks(2),
      embeddingBatches: [createBatch({ attemptCount: 1, status: "processing", updatedAt: NOW - 5 * 60 * 1000 + 1 })]
    })

    const claimed = await claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(claimed).toBeNull()
    expect(db.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 1, status: "processing" })
    expect(db.patchedRows).toEqual([])
  })

  it("does not claim batches for inactive jobs or stale chunks", async () => {
    const failedJobDb = createDb({
      chunks: createChunks(2),
      embeddingBatches: [createBatch()],
      ingestionJobs: [createJob({ status: "failed" })]
    })

    await expect(
      claimNextBatchHandler._handler(failedJobDb.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()
    expect(failedJobDb.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 0, status: "pending" })
    expect(failedJobDb.runAfter).not.toHaveBeenCalled()

    const staleChunkDb = createDb({
      chunks: createChunks(2, { isCurrent: false }),
      embeddingBatches: [createBatch()]
    })

    await expect(
      claimNextBatchHandler._handler(staleChunkDb.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()
    expect(staleChunkDb.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 0, status: "failed" })
    expect(staleChunkDb.tables.ingestionJobs[0]).toMatchObject({ status: "failed" })
    expect(staleChunkDb.tables.documents[0]).toMatchObject({ status: "failed" })
    expect(staleChunkDb.runAfter).not.toHaveBeenCalled()
  })

  it("fails already-embedded batches when their chunks belong to another job", async () => {
    const db = createDb({
      chunkEmbeddings: [createChunkEmbedding("chunks_1"), createChunkEmbedding("chunks_2")],
      chunks: createChunks(2, {
        documentId: "documents_2",
        ingestionJobId: "ingestionJobs_2",
        isCurrent: true
      }),
      embeddingBatches: [createBatch({ attemptCount: 2, status: "retrying" })]
    })

    await expect(claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })).resolves.toBeNull()

    expect(db.tables.embeddingBatches[0]).toMatchObject({ status: "failed" })
    expect(db.tables.ingestionJobs[0]).toMatchObject({ status: "failed" })
    expect(db.runAfter).not.toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      offset: 0,
      phase: "cleanup"
    })
  })

  it("marks already-embedded batches completed and claims the next candidate", async () => {
    const chunks = createChunks(4)
    const db = createDb({
      chunkEmbeddings: [createChunkEmbedding("chunks_1"), createChunkEmbedding("chunks_2")],
      chunks,
      embeddingBatches: [
        createBatch({
          _id: "embeddingBatches_1",
          attemptCount: 3,
          batchIndex: 0,
          chunkIds: ["chunks_1", "chunks_2"],
          status: "retrying"
        }),
        createBatch({ _id: "embeddingBatches_2", batchIndex: 1, chunkIds: ["chunks_3", "chunks_4"] })
      ]
    })

    const claimed = await claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(claimed).toMatchObject({
      batchId: "embeddingBatches_2",
      chunkIds: ["chunks_3", "chunks_4"],
      contents: ["Chunk content 3", "Chunk content 4"]
    })
    expect(db.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 3, status: "completed", updatedAt: NOW })
    expect(db.tables.embeddingBatches[1]).toMatchObject({ attemptCount: 1, status: "processing", updatedAt: NOW })
  })

  it("completes the job atomically when the last batch already has embeddings", async () => {
    const db = createDb({
      chunkEmbeddings: [createChunkEmbedding("chunks_1"), createChunkEmbedding("chunks_2")],
      chunks: createChunks(2),
      embeddingBatches: [createBatch({ attemptCount: 3, status: "retrying" })]
    })

    const claimed = await claimNextBatchHandler._handler(db.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(claimed).toBeNull()
    expect(db.tables.embeddingBatches[0]).toMatchObject({ finalizedAt: NOW, status: "completed", updatedAt: NOW })
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      offset: 0,
      phase: "cleanup"
    })
  })

  it("marks a rate-limited batch and moves an embedding job into waiting", async () => {
    const db = createDb({ embeddingBatches: [createBatch({ status: "processing" })] })

    await markBatchRateLimitedHandler._handler(db.ctx as never, {
      attemptCount: 0,
      batchId: "embeddingBatches_1",
      jobId: JOB_ID,
      lastProviderKeyId: "jina:1",
      retryAfterMs: 15_000
    })

    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 15_000,
      status: "rate_limited",
      updatedAt: NOW
    })
    expect(db.tables.embeddingBatches[0].lastErrorMessage).not.toContain("secret")
    expect(db.tables.ingestionJobs[0]).toMatchObject({ status: "embedding_waiting_rate_limit", updatedAt: NOW })
    expect(db.runAfter).toHaveBeenCalledWith(15_000, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })
  })

  it("ignores stale rate-limit results from an older claimed attempt", async () => {
    const db = createDb({ embeddingBatches: [createBatch({ attemptCount: 2, status: "completed" })] })

    await markBatchRateLimitedHandler._handler(db.ctx as never, {
      attemptCount: 1,
      batchId: "embeddingBatches_1",
      jobId: JOB_ID,
      lastProviderKeyId: "jina:1",
      retryAfterMs: 15_000
    })

    expect(db.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 2, status: "completed" })
    expect(db.tables.ingestionJobs[0]).toMatchObject({ status: "embedding" })
    expect(db.runAfter).not.toHaveBeenCalled()
  })

  it("ignores stale permanent failures from an older claimed attempt", async () => {
    const db = createDb({ embeddingBatches: [createBatch({ attemptCount: 2, status: "completed" })] })
    const failedDocuments: MutationArgs[] = []
    const runMutation = vi.fn(async (_reference: unknown, args: MutationArgs) => {
      failedDocuments.push(args)
      return null
    })

    await markBatchFailedHandler._handler({ ...db.ctx, runMutation } as never, {
      attemptCount: 1,
      batchId: "embeddingBatches_1",
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      lastProviderKeyId: "jina:1"
    })

    expect(db.tables.embeddingBatches[0]).toMatchObject({ attemptCount: 2, status: "completed" })
    expect(failedDocuments).toEqual([])
  })

  it("marks a retrying batch and schedules retry atomically", async () => {
    const db = createDb({ embeddingBatches: [createBatch({ status: "processing" })] })

    await markBatchRetryingHandler._handler(db.ctx as never, {
      attemptCount: 0,
      batchId: "embeddingBatches_1",
      lastProviderKeyId: "jina:1",
      retryAfterMs: 5_000
    })

    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 5_000,
      status: "retrying"
    })
    expect(db.runAfter).toHaveBeenCalledWith(5_000, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })
  })

  it("marks a final completed batch and schedules exact-term indexing atomically", async () => {
    const db = createDb({ embeddingBatches: [createBatch({ status: "processing" })] })

    await markBatchCompletedHandler._handler(db.ctx as never, { attemptCount: 0, batchId: "embeddingBatches_1" })

    expect(db.tables.embeddingBatches[0]).toMatchObject({ finalizedAt: NOW, status: "completed", updatedAt: NOW })
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      offset: 0,
      phase: "cleanup"
    })
  })

  it("marks a non-final completed batch and schedules the next batch atomically", async () => {
    const db = createDb({
      embeddingBatches: [
        createBatch({ _id: "embeddingBatches_1", batchIndex: 0, status: "processing" }),
        createBatch({ _id: "embeddingBatches_2", batchIndex: 1, status: "pending" })
      ]
    })

    await markBatchCompletedHandler._handler(db.ctx as never, { attemptCount: 0, batchId: "embeddingBatches_1" })

    expect(db.tables.embeddingBatches[0].finalizedAt).toBeUndefined()
    expect(db.tables.embeddingBatches[0]).toMatchObject({ status: "completed", updatedAt: NOW })
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })
  })

  it("schedules exact-term indexing only after every batch is completed", async () => {
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")
    const db = createDb({
      embeddingBatches: [
        createBatch({ status: "completed" }),
        createBatch({ _id: "embeddingBatches_2", batchIndex: 1, status: "completed" })
      ],
      ingestionJobs: [createJob({ status: "embedding_waiting_rate_limit" })]
    })

    const scheduled = await completeJobIfAllBatchesDoneHandler._handler({ ...db.ctx, scheduler: { runAfter } } as never, {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID
    })

    expect(scheduled).toBe(true)
    expect(db.tables.ingestionJobs[0]).toMatchObject({ status: "embedding" })
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      offset: 0,
      phase: "cleanup"
    })
  })

  it("schedules exact-term indexing only once when completion is retried", async () => {
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")
    const db = createDb({
      embeddingBatches: [
        createBatch({ status: "completed" }),
        createBatch({ _id: "embeddingBatches_2", batchIndex: 1, status: "completed" })
      ]
    })
    const ctx = { ...db.ctx, scheduler: { runAfter } }

    const first = await completeJobIfAllBatchesDoneHandler._handler(ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    const second = await completeJobIfAllBatchesDoneHandler._handler(ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(runAfter).toHaveBeenCalledTimes(1)
    expect(db.tables.embeddingBatches).toEqual(expect.arrayContaining([expect.objectContaining({ finalizedAt: NOW })]))
  })
})

describe("processNextBatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    embedDocumentTexts.mockReset()
    estimateJinaEmbeddingRequestCount.mockReset()
    estimateJinaEmbeddingRequestCount.mockImplementation((inputs: string[]) => Math.max(1, Math.ceil(inputs.length / 50)))
    getProviderEnv.mockReset()
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    getProviderEnv.mockReturnValue({
      jinaApiKeys: ["jina-secret-1", "jina-secret-2"],
      jinaEmbedModel: "jina-test-model",
      jinaMaxConcurrentPerKey: 2,
      jinaRpmPerKey: 90,
      jinaTpmPerKey: 90_000
    })
  })

  it("reserves a Jina key before calling embedDocumentTexts", async () => {
    const order: string[] = []
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    embedDocumentTexts.mockImplementation(async () => {
      order.push("embed")
      return [createEmbedding(0.1), createEmbedding(0.2)]
    })
    const action = createActionCtx({ db })
    action.runMutation.mockImplementation(async (_reference: unknown, args: MutationArgs) => {
      if ("estimatedInputTokens" in args) {
        order.push("reserve")
      }
      return await createActionCtx({ db }).runMutation(_reference, args)
    })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(order).toEqual(["reserve", "embed"])
  })

  it("reserves RPM capacity for every Jina HTTP request in a split batch", async () => {
    const chunks = createChunks(51)
    const db = createDb({
      chunks,
      embeddingBatches: [createBatch({ chunkIds: chunks.map((chunk) => chunk._id) })]
    })
    embedDocumentTexts.mockResolvedValue(chunks.map((_chunk, index) => createEmbedding(index + 1)))
    const action = createActionCtx({ db })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(action.mutationCalls).toContainEqual(
      expect.objectContaining({
        estimatedRequestCount: 2,
        provider: "jina"
      })
    )
  })

  it("inserts embeddings, records success, completes the batch, and schedules the next batch", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    const embeddings = [createEmbedding(0.1), createEmbedding(0.2)]
    embedDocumentTexts.mockResolvedValue(embeddings)
    const action = createActionCtx({ db })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(embedDocumentTexts).toHaveBeenCalledWith(["Chunk content 1", "Chunk content 2"], {
      apiKey: "jina-secret-1",
      keyId: "jina:1",
      model: "jina-test-model"
    })
    expect(action.providerSuccesses).toContainEqual(expect.objectContaining({ keyId: "jina:1", provider: "jina" }))
    expect(action.insertedEmbeddings).toContainEqual({
      attemptCount: 1,
      batchId: "embeddingBatches_1",
      chunkIds: ["chunks_1", "chunks_2"],
      embeddingModel: "jina-test-model",
      embeddings,
      jobId: JOB_ID
    })
    expect(db.tables.embeddingBatches[0]).toMatchObject({ finalizedAt: NOW, status: "completed" })
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      offset: 0,
      phase: "cleanup"
    })
  })

  it("records provider cooldown and schedules retry when Jina rate limits a selected key", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    embedDocumentTexts.mockRejectedValue(new ProviderRateLimitError({ keyId: "jina:1", provider: "jina", retryAfterMs: 12_000 }))
    const action = createActionCtx({ db })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(action.providerRateLimits).toContainEqual({ keyId: "jina:1", provider: "jina", retryAfterMs: 12_000 })
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 12_000,
      status: "rate_limited"
    })
    expect(db.tables.ingestionJobs[0]).toMatchObject({ status: "embedding_waiting_rate_limit" })
    expect(db.runAfter).toHaveBeenCalledWith(12_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("does not call Jina when reservation reports all-key cooldown", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    const action = createActionCtx({ db, reservation: { available: false, retryAfterMs: 30_000 } })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(embedDocumentTexts).not.toHaveBeenCalled()
    expect(db.tables.embeddingBatches[0]).toMatchObject({ nextRunAt: NOW + 30_000, status: "rate_limited" })
    expect(db.runAfter).toHaveBeenCalledWith(30_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("marks a claimed batch failed when provider environment resolution fails", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    getProviderEnv.mockImplementation(() => {
      throw new Error("JINA_API_KEYS is required")
    })
    const action = createActionCtx({ db })

    await expect(
      processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()

    expect(embedDocumentTexts).not.toHaveBeenCalled()
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastErrorMessage: "Embedding provider failed permanently. Operator intervention is required.",
      status: "failed"
    })
    expect(action.failedDocuments).toContainEqual({
      documentId: DOCUMENT_ID,
      errorMessage: "Embedding provider failed permanently. Operator intervention is required.",
      jobId: JOB_ID
    })
  })

  it("marks a claimed batch retrying when provider reservation fails", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    const action = createActionCtx({ db, reservationError: new Error("reservation mutation failed") })

    await expect(
      processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()

    expect(embedDocumentTexts).not.toHaveBeenCalled()
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastErrorMessage: "Embedding provider failed transiently. The batch will retry automatically.",
      nextRunAt: NOW + 5_000,
      status: "retrying"
    })
    expect(db.runAfter).toHaveBeenCalledWith(5_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("disables a quota-exhausted key and schedules an immediate retry without failing the document", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    embedDocumentTexts.mockRejectedValue(new ProviderQuotaExhaustedError({ keyId: "jina:1", provider: "jina" }))
    const action = createActionCtx({ db })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(action.disabledKeys).toContainEqual({ keyId: "jina:1", provider: "jina", reason: "quota_exhausted" })
    expect(db.tables.embeddingBatches[0]).toMatchObject({ status: "retrying" })
    expect(db.tables.documents[0]).toMatchObject({ status: "processing" })
    expect(db.runAfter).toHaveBeenCalledWith(0, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("retries post-provider persistence failures without classifying them as provider failures", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    const embeddings = [createEmbedding(0.1), createEmbedding(0.2)]
    embedDocumentTexts.mockResolvedValue(embeddings)
    const action = createActionCtx({ db, insertEmbeddingsError: new Error("insert failed") })

    await expect(
      processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()

    expect(action.providerSuccesses).toContainEqual({ keyId: "jina:1", provider: "jina" })
    expect(action.providerTransientFailures).toEqual([])
    expect(action.failedDocuments).toEqual([])
    expect(db.tables.documents[0]).toMatchObject({ status: "processing" })
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastErrorMessage: "Embedding provider failed transiently. The batch will retry automatically.",
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 5_000,
      status: "retrying"
    })
    expect(db.runAfter).toHaveBeenCalledWith(5_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("marks retrying when embeddings persist but completion marking fails", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    const embeddings = [createEmbedding(0.1), createEmbedding(0.2)]
    embedDocumentTexts.mockResolvedValue(embeddings)
    const action = createActionCtx({ db, markCompletedError: new Error("mark completed failed") })

    await expect(
      processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()

    expect(action.providerSuccesses).toContainEqual({ keyId: "jina:1", provider: "jina" })
    expect(action.insertedEmbeddings).toContainEqual({
      attemptCount: 1,
      batchId: "embeddingBatches_1",
      chunkIds: ["chunks_1", "chunks_2"],
      embeddingModel: "jina-test-model",
      embeddings,
      jobId: JOB_ID
    })
    expect(action.mutationFunctionNames).toContain("embeddingBatches:markBatchRetrying")
    expect(action.providerTransientFailures).toEqual([])
    expect(action.failedDocuments).toEqual([])
    expect(db.tables.documents[0]).toMatchObject({ status: "processing" })
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastErrorMessage: "Embedding provider failed transiently. The batch will retry automatically.",
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 5_000,
      status: "retrying"
    })
    expect(db.runAfter).toHaveBeenCalledWith(5_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("releases the reserved key when provider success recording fails after embedding succeeds", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    embedDocumentTexts.mockResolvedValue([createEmbedding(0.1), createEmbedding(0.2)])
    const action = createActionCtx({ db, recordProviderSuccessError: new Error("success recording failed") })

    await expect(
      processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })
    ).resolves.toBeNull()

    expect(action.providerTransientFailures).toContainEqual({ keyId: "jina:1", provider: "jina" })
    expect(action.failedDocuments).toEqual([])
    expect(db.tables.documents[0]).toMatchObject({ status: "processing" })
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastErrorMessage: "Embedding provider failed transiently. The batch will retry automatically.",
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 5_000,
      status: "retrying"
    })
    expect(action.mutationFunctionNames.indexOf("providerRateLimits:recordProviderTransientFailure")).toBeLessThan(
      action.mutationFunctionNames.indexOf("embeddingBatches:markBatchRetrying")
    )
    expect(db.runAfter).toHaveBeenCalledWith(5_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("records transient provider failures and schedules a short retry", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    embedDocumentTexts.mockRejectedValue(new ProviderTransientError({ keyId: "jina:1", provider: "jina" }))
    const action = createActionCtx({ db })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(action.providerTransientFailures).toContainEqual({ keyId: "jina:1", provider: "jina" })
    expect(db.tables.embeddingBatches[0]).toMatchObject({
      lastErrorMessage: "Embedding provider failed transiently. The batch will retry automatically.",
      lastProviderKeyId: "jina:1",
      nextRunAt: NOW + 5_000,
      status: "retrying"
    })
    expect(db.runAfter).toHaveBeenCalledWith(5_000, expect.anything(), { documentId: DOCUMENT_ID, jobId: JOB_ID })
  })

  it("releases a reserved provider key before failing when the selected key is not configured", async () => {
    const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
    const action = createActionCtx({ db, reservation: { available: true, keyId: "jina:missing" } })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(action.providerTransientFailures).toContainEqual({ keyId: "jina:missing", provider: "jina" })
    expect(action.mutationFunctionNames.indexOf("providerRateLimits:recordProviderTransientFailure")).toBeLessThan(
      action.mutationFunctionNames.indexOf("embeddingBatches:markBatchFailed")
    )
    expect(db.tables.embeddingBatches[0]).toMatchObject({ lastProviderKeyId: "jina:missing", status: "failed" })
  })

  it("marks the batch and document failed on permanent or unknown provider failures", async () => {
    const failureCases = [
      new ProviderPermanentError({ keyId: "jina:1", provider: "jina" }),
      new Error("secret chunk content and jina-secret-1 must not be persisted")
    ]

    for (const failure of failureCases) {
      const db = createDb({ chunks: createChunks(2), embeddingBatches: [createBatch()] })
      embedDocumentTexts.mockReset()
      embedDocumentTexts.mockRejectedValue(failure)
      const action = createActionCtx({ db })

      await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

      expect(db.tables.embeddingBatches[0]).toMatchObject({
        lastErrorMessage: "Embedding provider failed permanently. Operator intervention is required.",
        lastProviderKeyId: "jina:1",
        nextRunAt: undefined,
        status: "failed"
      })
      expect(action.failedDocuments).toContainEqual({
        documentId: DOCUMENT_ID,
        errorMessage: "Embedding provider failed permanently. Operator intervention is required.",
        jobId: JOB_ID
      })
      expect(db.tables.ingestionJobs[0]).toMatchObject({
        errorMessage: "Embedding provider failed permanently. Operator intervention is required.",
        status: "failed"
      })
      expect(db.tables.documents[0]).toMatchObject({ status: "failed" })
      expect(action.providerTransientFailures).toContainEqual({ keyId: "jina:1", provider: "jina" })
      expect(action.mutationFunctionNames.indexOf("providerRateLimits:recordProviderTransientFailure")).toBeLessThan(
        action.mutationFunctionNames.indexOf("embeddingBatches:markBatchFailed")
      )
      expect(JSON.stringify(db.tables.embeddingBatches[0])).not.toContain("secret chunk")
      expect(JSON.stringify(db.tables.ingestionJobs[0])).not.toContain("jina-secret-1")
    }
  })

  it("does not insert duplicate embeddings when every batch is already completed", async () => {
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")
    const db = createDb({
      chunks: createChunks(2),
      embeddingBatches: [createBatch({ status: "completed" })]
    })
    const action = createActionCtx({ db, scheduled: runAfter })
    let completionCallCount = 0
    action.runMutation.mockImplementation(async (_reference: unknown, args: MutationArgs) => {
      if ("documentId" in args && "jobId" in args && Object.keys(args).length === 2) {
        completionCallCount += 1
        if (completionCallCount === 1) {
          return await claimNextBatchHandler._handler(db.ctx as never, args as never)
        }
        return await completeJobIfAllBatchesDoneHandler._handler({ ...db.ctx, scheduler: { runAfter } } as never, args as never)
      }
      return null
    })

    await processNextBatchHandler._handler(action.ctx as never, { documentId: DOCUMENT_ID, jobId: JOB_ID })

    expect(embedDocumentTexts).not.toHaveBeenCalled()
    expect(action.insertedEmbeddings).toEqual([])
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      offset: 0,
      phase: "cleanup"
    })
  })
})
