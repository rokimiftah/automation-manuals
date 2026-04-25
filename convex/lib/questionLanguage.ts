export type QuestionLanguage = {
  code: "en" | "id" | "same_as_question"
  instruction: string
}

const INDONESIAN_MARKERS = ["bagaimana", "apakah", "dengan", "untuk", "yang", "dan", "atau", "bisa", "cara"]

function tokenize(question: string) {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function detectQuestionLanguage(question: string): QuestionLanguage {
  const tokens = tokenize(question)
  const indonesianHits = tokens.filter((token) => INDONESIAN_MARKERS.includes(token)).length

  if (indonesianHits >= 1) {
    return {
      code: "id",
      instruction: "Answer in Indonesian."
    }
  }

  if (/\b(how|what|where|when|why|should|can|please|show)\b/i.test(question)) {
    return {
      code: "en",
      instruction: "Answer in English."
    }
  }

  return {
    code: "same_as_question",
    instruction: "Answer in the same language as the user's question."
  }
}

export function getRefusalSummaryForLanguage(language: QuestionLanguage) {
  if (language.code === "id") {
    return "Saya tidak menemukan bukti yang cukup di dokumentasi resmi untuk menjawabnya dengan aman."
  }

  return "I could not find enough evidence in the official documentation to answer that safely."
}
