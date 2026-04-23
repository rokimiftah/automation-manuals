export type ParsedPage = {
  markdown: string
  needsOcrFallback?: boolean
  pageNumber: number
  printedPageNumber?: string
}
