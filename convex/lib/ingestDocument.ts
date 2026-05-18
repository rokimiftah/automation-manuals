import type { ParsedPage } from "./parsedPage"

import { normalizeParsedPages } from "./normalize"

export function buildNormalizedDocumentPayload(parsedPages: ParsedPage[]) {
  const normalized = normalizeParsedPages(parsedPages)

  return {
    chunks: normalized.chunks,
    pages: normalized.pages
  }
}
