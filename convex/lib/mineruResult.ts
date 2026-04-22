import type { NormalizedDocument } from "./normalize"

import { normalizeParsedPages } from "./normalize"

type MineruSpan = {
  bbox?: number[]
  content?: string
  html?: string
  image_path?: string
  type: string
}

type MineruLine = {
  bbox?: number[]
  spans?: MineruSpan[]
}

type MineruBlock = {
  bbox?: number[]
  blocks?: MineruBlock[]
  lines?: MineruLine[]
  type: string
}

type MineruPage = {
  discarded_blocks?: MineruBlock[]
  page_idx: number
  page_size?: number[]
  para_blocks?: MineruBlock[]
}

type MineruDocument = {
  pdf_info: MineruPage[]
}

function extractTextFromBlock(block: MineruBlock): string {
  const directText = (block.lines ?? [])
    .flatMap((line) => line.spans ?? [])
    .map((span) => span.content?.trim() ?? "")
    .filter(Boolean)
    .join(" ")

  if (directText) {
    return directText
  }

  return (block.blocks ?? []).map(extractTextFromBlock).filter(Boolean).join(" ")
}

function extractTableHtml(block: MineruBlock): string | undefined {
  for (const line of block.lines ?? []) {
    for (const span of line.spans ?? []) {
      const html = span.html?.trim()
      if (html) {
        return html
      }
    }
  }

  for (const child of block.blocks ?? []) {
    const html = extractTableHtml(child)
    if (html) {
      return html
    }
  }

  return undefined
}

function extractImageUrl(block: MineruBlock): string | undefined {
  for (const line of block.lines ?? []) {
    for (const span of line.spans ?? []) {
      const imageUrl = span.image_path?.trim()
      if (imageUrl) {
        return imageUrl
      }
    }
  }

  for (const child of block.blocks ?? []) {
    const imageUrl = extractImageUrl(child)
    if (imageUrl) {
      return imageUrl
    }
  }

  return undefined
}

function renderMarkdownBlock(block: MineruBlock): string {
  if (block.type === "title") {
    const text = extractTextFromBlock(block)
    return text ? `# ${text}` : ""
  }

  if (block.type === "text") {
    return extractTextFromBlock(block)
  }

  if (block.type === "table") {
    return extractTableHtml(block) ?? ""
  }

  if (block.type === "image") {
    const imageUrl = extractImageUrl(block)
    return imageUrl ? `![image](${imageUrl})` : ""
  }

  return ""
}

function inferPrintedPageNumber(page: MineruPage) {
  const pageNumberBlock = (page.discarded_blocks ?? []).find((block) => block.type === "page_number")
  const pageNumber = pageNumberBlock ? extractTextFromBlock(pageNumberBlock).trim() : ""
  return pageNumber || undefined
}

export function normalizeMineruDocument(document: MineruDocument): NormalizedDocument {
  return normalizeParsedPages(
    document.pdf_info.map((page) => ({
      markdown: (page.para_blocks ?? []).map(renderMarkdownBlock).filter(Boolean).join("\n\n"),
      pageNumber: page.page_idx + 1,
      ...(inferPrintedPageNumber(page) ? { printedPageNumber: inferPrintedPageNumber(page) } : {})
    }))
  )
}
