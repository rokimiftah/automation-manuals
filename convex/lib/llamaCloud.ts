import LlamaCloud from "@llamaindex/llama-cloud"

import { getProviderEnv } from "./env"

export type ParsedPage = {
  markdown: string
  pageNumber: number
  printedPageNumber?: string
}

type ParseJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"

type MarkdownResultPage = {
  markdown?: string | null
  page_number: number
  printed_page_number?: string | null
  success?: boolean | null
}

type ParsingCreateResponse = {
  id: string
}

type ParsingMarkdownResponse = {
  job: {
    error_message?: string | null
    id: string
    status: ParseJobStatus
  }
  markdown?: {
    pages?: MarkdownResultPage[] | null
  } | null
}

type LlamaCloudClientLike = {
  parsing: {
    create: (args: Record<string, unknown>) => Promise<ParsingCreateResponse>
    get: (jobId: string, args: { expand: ["markdown"] }) => Promise<ParsingMarkdownResponse>
  }
}

type ParseDocumentOptions = {
  client?: LlamaCloudClientLike
  maxAttempts?: number
  pollIntervalMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

function getLlamaCloudClient(): LlamaCloudClientLike {
  return new LlamaCloud({ apiKey: getProviderEnv().llamaCloudApiKey }) as unknown as LlamaCloudClientLike
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function isTerminalStatus(status: ParseJobStatus) {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
}

function cleanPrintedPageNumber(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function extractParsedPages(result: ParsingMarkdownResponse) {
  return (result.markdown?.pages ?? [])
    .filter((page) => page.success !== false)
    .map((page) => {
      const markdown = page.markdown?.trim() ?? ""
      return {
        markdown,
        pageNumber: page.page_number,
        printedPageNumber: cleanPrintedPageNumber(page.printed_page_number)
      } satisfies ParsedPage
    })
    .filter((page) => page.markdown.length > 0)
}

function buildParseRequest(sourceUrl: string) {
  return {
    source_url: sourceUrl,
    tier: "agentic",
    version: "latest",
    output_options: {
      extract_printed_page_number: true,
      markdown: {
        tables: {
          merge_continued_tables: true,
          output_tables_as_markdown: true
        }
      }
    }
  }
}

export async function parseDocumentMarkdown(sourceUrl: string, options: ParseDocumentOptions = {}) {
  const client = options.client ?? getLlamaCloudClient()
  const maxAttempts = options.maxAttempts ?? 60
  const pollIntervalMs = options.pollIntervalMs ?? 250
  const wait = options.sleep ?? sleep

  const created = await client.parsing.create(buildParseRequest(sourceUrl))
  let attempt = 0

  while (attempt < maxAttempts) {
    const result = await client.parsing.get(created.id, { expand: ["markdown"] })

    if (result.job.status === "COMPLETED") {
      return extractParsedPages(result)
    }

    if (result.job.status === "FAILED" || result.job.status === "CANCELLED") {
      const message = result.job.error_message?.trim() || "Unknown parsing error"
      throw new Error(`LlamaCloud parse job ${created.id} ${result.job.status.toLowerCase()}: ${message}`)
    }

    if (!isTerminalStatus(result.job.status)) {
      attempt += 1
      if (attempt < maxAttempts) {
        await wait(pollIntervalMs)
      }
    }
  }

  throw new Error(`LlamaCloud parse job ${created.id} did not complete after ${maxAttempts} attempts`)
}
