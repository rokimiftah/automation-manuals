const MAX_QUERY_TOKENS = 8
const MAX_CHUNK_TOKENS = 64
const MAX_TERMS_PER_CHUNK = 64

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export function normalizeExactTerm(value: string) {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[\p{Pd}]+/gu, "-")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
  )
}

function tokenize(value: string) {
  return normalizeExactTerm(value)
    .split(" ")
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2)
}

function shouldKeepSingleToken(token: string) {
  return token.length >= 3 || /\d/.test(token)
}

function pushPhraseTerms(target: Set<string>, tokens: string[], maxGram: number, maxTerms: number) {
  for (let gramSize = Math.min(maxGram, tokens.length); gramSize >= 1; gramSize -= 1) {
    for (let index = 0; index <= tokens.length - gramSize; index += 1) {
      if (target.size >= maxTerms) {
        return
      }

      const phrase = tokens.slice(index, index + gramSize).join(" ")
      if (gramSize === 1 && !shouldKeepSingleToken(phrase)) {
        continue
      }

      target.add(phrase)
    }
  }
}

export function extractExactSearchTerms(question: string) {
  const terms = new Set<string>()
  const normalizedQuestion = normalizeExactTerm(question)
  if (!normalizedQuestion) {
    return []
  }

  terms.add(normalizedQuestion)

  const tokens = tokenize(question).slice(0, MAX_QUERY_TOKENS)
  pushPhraseTerms(terms, tokens, 3, 24)
  return [...terms]
}

export function buildChunkTerms(input: { citationLabel: string; content: string }) {
  const terms = new Set<string>()
  const citation = normalizeExactTerm(input.citationLabel)
  if (citation) {
    terms.add(citation)
  }

  const content = normalizeExactTerm(input.content)
  if (content) {
    terms.add(content)
  }

  pushPhraseTerms(terms, tokenize(input.citationLabel).slice(0, 12), 2, 16)
  pushPhraseTerms(terms, tokenize(input.content).slice(0, MAX_CHUNK_TOKENS), 2, MAX_TERMS_PER_CHUNK)
  return [...terms]
}
