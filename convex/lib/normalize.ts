import type { ParsedPage } from "./llamaCloud"

export type ChunkType = "text" | "table" | "diagram_description" | "warning" | "spec"

export type NormalizedPage = ParsedPage & {
  needsOcrFallback: boolean
}

export type NormalizedChunk = {
  citationLabel: string
  chunkType: ChunkType
  content: string
  pageNumber: number
}

export type NormalizedDocument = {
  chunks: NormalizedChunk[]
  pages: NormalizedPage[]
}

function splitMarkdownBlocks(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

export function classifyMarkdownBlock(block: string) {
  if (/^\|.+\|$/m.test(block)) {
    return "table" as const
  }

  if (/warning|danger|caution/i.test(block)) {
    return "warning" as const
  }

  if (/wiring|slot|backplane|chassis|diagram/i.test(block)) {
    return "diagram_description" as const
  }

  if (/catalog|module|specification|terminal|connector/i.test(block)) {
    return "spec" as const
  }

  return "text" as const
}

export function needsOcrFallback(markdown: string) {
  const trimmed = markdown.trim()
  return trimmed.startsWith("![") || trimmed.length < 80
}

export function buildCitationLabel(pageNumber: number, printedPageNumber?: string) {
  const label = printedPageNumber?.trim()
  return label ? `Page ${label}` : `Page ${pageNumber}`
}

export function normalizeParsedPages(pages: ParsedPage[]): NormalizedDocument {
  const normalizedPages = pages.map((page) => ({
    ...page,
    needsOcrFallback: needsOcrFallback(page.markdown)
  }))

  const chunks = pages.flatMap((page) =>
    splitMarkdownBlocks(page.markdown).map((block) => ({
      citationLabel: buildCitationLabel(page.pageNumber, page.printedPageNumber),
      chunkType: classifyMarkdownBlock(block),
      content: block,
      pageNumber: page.pageNumber
    }))
  )

  return {
    chunks,
    pages: normalizedPages
  }
}
