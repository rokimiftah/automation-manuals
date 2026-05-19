const MAX_QUERY_TOKENS = 8
const MAX_CHUNK_TOKENS = 64
const MAX_TERMS_PER_CHUNK = 64
const MAX_STRONG_IDENTIFIER_TERMS_PER_CHUNK = 32

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

export function isStrongExactIdentifierTerm(value: string) {
  const token = normalizeExactTerm(value).replace(/^-+|-+$/g, "")

  return token.length >= 2 && !/\s/.test(token) && /\d/.test(token) && (/\p{L}/u.test(token) || token.includes("-"))
}

export function isFaultCodeLikeExactTerm(value: string) {
  const token = normalizeExactTerm(value).replace(/^-+|-+$/g, "")

  return /^[ef]-?\d+[a-z]?$/u.test(token)
}

function buildExactIdentifierVariants(value: string) {
  const token = normalizeExactTerm(value).replace(/^-+|-+$/g, "")
  if (!isStrongExactIdentifierTerm(token)) {
    return []
  }

  const variants = new Set([token])
  const compactToken = token.replace(/-/g, "")
  if (compactToken !== token && isStrongExactIdentifierTerm(compactToken)) {
    variants.add(compactToken)
  }

  const faultCodeMatch = /^([ef])(\d+[a-z]?)$/u.exec(compactToken)
  if (faultCodeMatch) {
    variants.add(`${faultCodeMatch[1]}-${faultCodeMatch[2]}`)
  }

  return [...variants]
}

function addBoundedExactIdentifierVariants(target: Set<string>, tokens: string[], maxTerms: number) {
  const faultCodeTerms = new Set<string>()
  const identifierTerms = new Set<string>()

  for (const token of tokens) {
    const variants = buildExactIdentifierVariants(token)
    if (variants.length === 0) {
      continue
    }

    const targetSet = variants.some(isFaultCodeLikeExactTerm) ? faultCodeTerms : identifierTerms
    for (const variant of variants) {
      targetSet.add(variant)
    }
  }

  let added = 0
  for (const variant of [...faultCodeTerms, ...identifierTerms]) {
    if (added >= maxTerms) {
      return
    }

    if (!target.has(variant)) {
      target.add(variant)
      added += 1
    }
  }
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

  const tokens = tokenize(question)
  const faultCodeTerms = new Set<string>()
  const identifierTerms = new Set<string>()
  for (const token of tokens) {
    const variants = buildExactIdentifierVariants(token)
    if (variants.length === 0) {
      continue
    }

    if (variants.some(isFaultCodeLikeExactTerm)) {
      for (const variant of variants) {
        faultCodeTerms.add(variant)
      }
    } else {
      for (const variant of variants) {
        identifierTerms.add(variant)
      }
    }
  }
  for (const term of faultCodeTerms) {
    terms.add(term)
  }
  for (const term of identifierTerms) {
    terms.add(term)
  }

  pushPhraseTerms(terms, tokens.slice(0, MAX_QUERY_TOKENS), 3, 24)
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

  const citationTokens = tokenize(input.citationLabel)
  const contentTokens = tokenize(input.content)

  pushPhraseTerms(terms, citationTokens.slice(0, 12), 2, 16)
  pushPhraseTerms(terms, contentTokens.slice(0, MAX_CHUNK_TOKENS), 2, MAX_TERMS_PER_CHUNK)
  addBoundedExactIdentifierVariants(terms, [...citationTokens, ...contentTokens], MAX_STRONG_IDENTIFIER_TERMS_PER_CHUNK)
  return [...terms]
}
