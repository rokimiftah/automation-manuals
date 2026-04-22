import type { ParsedPage } from "./llamaCloud"
import { normalizeParsedPages } from "./normalize"

type BuildDocumentPayloadArgs = {
  embed: (inputs: string[]) => Promise<number[][]>
  ocr: (sourceUrl: string, pageNumber: number) => Promise<string>
  parse: () => Promise<ParsedPage[]>
  sourceUrl: string
}

export async function buildDocumentPayload(args: BuildDocumentPayloadArgs) {
  const parsedPages = await args.parse()
  const initial = normalizeParsedPages(parsedPages)

  const pages = await Promise.all(
    initial.pages.map(async (page) => ({
      pageNumber: page.pageNumber,
      printedPageNumber: page.printedPageNumber,
      markdown: page.needsOcrFallback ? await args.ocr(args.sourceUrl, page.pageNumber) : page.markdown
    }))
  )

  const normalized = normalizeParsedPages(pages)
  const embeddings =
    normalized.chunks.length === 0 ? [] : await args.embed(normalized.chunks.map((chunk) => chunk.content))

  if (embeddings.length !== normalized.chunks.length) {
    throw new Error("Embedding count does not match chunk count")
  }

  return {
    chunks: normalized.chunks,
    embeddings,
    pages: normalized.pages
  }
}
