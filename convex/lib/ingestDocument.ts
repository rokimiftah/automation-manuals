import type { ParsedPage } from "./parsedPage"

import { normalizeParsedPages } from "./normalize"

type LegacyBuildDocumentPayloadArgs = {
  embed: (inputs: string[]) => Promise<number[][]>
  ocr: (sourceUrl: string, pageNumber: number) => Promise<string>
  parse: () => Promise<ParsedPage[]>
  sourceUrl: string
}

type ParsedPagesBuildDocumentPayloadArgs = {
  embed: (inputs: string[]) => Promise<number[][]>
  ocr?: (sourceUrl: string, pageNumber: number) => Promise<string>
  parsedPages: ParsedPage[]
  sourceUrl?: string
}

type BuildDocumentPayloadArgs = LegacyBuildDocumentPayloadArgs | ParsedPagesBuildDocumentPayloadArgs

function hasParsedPages(args: BuildDocumentPayloadArgs): args is ParsedPagesBuildDocumentPayloadArgs {
  return "parsedPages" in args
}

function hasOcrFallback(args: BuildDocumentPayloadArgs): args is BuildDocumentPayloadArgs & {
  ocr: (sourceUrl: string, pageNumber: number) => Promise<string>
  sourceUrl: string
} {
  return "ocr" in args && typeof args.ocr === "function" && "sourceUrl" in args && typeof args.sourceUrl === "string"
}

export async function buildDocumentPayload(args: BuildDocumentPayloadArgs) {
  const parsedPages = hasParsedPages(args) ? args.parsedPages : await args.parse()
  const initial = normalizeParsedPages(parsedPages)

  const pages = await Promise.all(
    initial.pages.map(async (page) => ({
      pageNumber: page.pageNumber,
      printedPageNumber: page.printedPageNumber,
      markdown: page.needsOcrFallback && hasOcrFallback(args) ? await args.ocr(args.sourceUrl, page.pageNumber) : page.markdown
    }))
  )

  const normalized = normalizeParsedPages(pages)
  const embeddings = normalized.chunks.length === 0 ? [] : await args.embed(normalized.chunks.map((chunk) => chunk.content))

  if (embeddings.length !== normalized.chunks.length) {
    throw new Error("Embedding count does not match chunk count")
  }

  return {
    chunks: normalized.chunks,
    embeddings,
    pages: normalized.pages
  }
}
