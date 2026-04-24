import type { IngestionStatus } from "./ingestionState"
import type { MineruBatchResult, MineruBatchResultItem, MineruBatchState } from "./mineruTypes"

type SubmitMineruBatchArgs = {
  callbackSeed?: string
  callbackUrl?: string
  fetch?: typeof fetch
  file: Blob
  fileName: string
  token: string
}

type PrepareMineruBatchUploadArgs = {
  callbackSeed?: string
  callbackUrl?: string
  fetch?: typeof fetch
  fileName: string
  token: string
}

type GetMineruBatchResultArgs = {
  batchId: string
  fetch?: typeof fetch
  token: string
}

type SubmitMineruBatchResponse = {
  code: number
  data?: {
    batch_id?: string
    file_urls?: string[]
  }
  msg?: string
  trace_id?: string
}

type GetMineruBatchResultResponse = {
  code: number
  data?: {
    batch_id?: string
    extract_result?: RawMineruBatchResultItem[]
  }
  msg?: string
  trace_id?: string
}

type RawMineruBatchResultItem = {
  data_id?: string
  err_code?: number
  err_msg?: string
  file_name: string
  full_zip_url?: string
  state: MineruBatchState
}

function getRequest(fetchImpl?: typeof fetch) {
  return fetchImpl ?? fetch
}

function requireOk(code: number | undefined, message: string | undefined) {
  if (code === 0) {
    return
  }

  throw new Error(message?.trim() || "MinerU request failed")
}

function _buildSubmitBody(args: SubmitMineruBatchArgs) {
  return {
    ...(args.callbackUrl === undefined ? {} : { callback: args.callbackUrl }),
    files: [{ name: args.fileName }],
    model_version: "vlm",
    ...(args.callbackSeed === undefined ? {} : { seed: args.callbackSeed })
  }
}

function buildPrepareBody(args: PrepareMineruBatchUploadArgs) {
  return {
    ...(args.callbackUrl === undefined ? {} : { callback: args.callbackUrl }),
    files: [{ name: args.fileName }],
    model_version: "vlm",
    ...(args.callbackSeed === undefined ? {} : { seed: args.callbackSeed })
  }
}

export async function prepareMineruBatchUpload(args: PrepareMineruBatchUploadArgs) {
  const request = getRequest(args.fetch)
  const response = await request("https://mineru.net/api/v4/file-urls/batch", {
    body: JSON.stringify(buildPrepareBody(args)),
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  })
  const payload = (await response.json()) as SubmitMineruBatchResponse

  requireOk(payload.code, payload.msg)

  const batchId = payload.data?.batch_id?.trim()
  const uploadUrl = payload.data?.file_urls?.[0]?.trim()
  if (!batchId || !uploadUrl) {
    throw new Error("MinerU batch submission did not return upload details")
  }

  return {
    batchId,
    ...(payload.trace_id?.trim() ? { traceId: payload.trace_id.trim() } : {}),
    uploadUrl
  }
}

export async function submitMineruBatch(args: SubmitMineruBatchArgs) {
  const request = getRequest(args.fetch)
  const { batchId, uploadUrl, traceId } = await prepareMineruBatchUpload(args)

  const uploadBody = await args.file.arrayBuffer()
  const uploadResponse = await request(uploadUrl, {
    body: uploadBody,
    method: "PUT"
  })
  if (!uploadResponse.ok) {
    throw new Error(`MinerU upload failed with status ${uploadResponse.status}`)
  }

  return {
    batchId,
    ...(traceId === undefined ? {} : { traceId })
  }
}

function mapMineruResultItem(item: RawMineruBatchResultItem): MineruBatchResultItem {
  return {
    ...(item.data_id ? { dataId: item.data_id } : {}),
    ...(item.err_code === undefined ? {} : { errorCode: item.err_code }),
    ...(item.err_msg?.trim() ? { errorMessage: item.err_msg.trim() } : {}),
    fileName: item.file_name,
    ...(item.full_zip_url?.trim() ? { resultUrl: item.full_zip_url.trim() } : {}),
    state: item.state
  }
}

export async function getMineruBatchResult(args: GetMineruBatchResultArgs): Promise<MineruBatchResult> {
  const request = getRequest(args.fetch)
  const response = await request(`https://mineru.net/api/v4/extract-results/batch/${args.batchId}`, {
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json"
    }
  })
  const payload = (await response.json()) as GetMineruBatchResultResponse

  requireOk(payload.code, payload.msg)

  return {
    batchId: payload.data?.batch_id?.trim() || args.batchId,
    results: (payload.data?.extract_result ?? []).map(mapMineruResultItem),
    traceId: payload.trace_id?.trim()
  }
}

export function mapMineruBatchState(state: MineruBatchState): IngestionStatus {
  if (state === "done") {
    return "downloading_result"
  }

  if (state === "running" || state === "converting") {
    return "processing_provider"
  }

  return "waiting_provider"
}
