export type ResponseLanguagePolicy = {
  instruction: string
}

export const ENGLISH_ONLY_RESPONSE_INSTRUCTION =
  "Answer every natural-language assistant response field in English, regardless of the user's question language, retrieved context language, manual language, or system instruction language. Preserve citation labels, fault codes, alarm codes, model numbers, product names, vendor names, commands, parameter names, units, and code when translation could change meaning. Do not translate technical identifiers."

export function buildResponseLanguagePolicy(_question: string): ResponseLanguagePolicy {
  return { instruction: ENGLISH_ONLY_RESPONSE_INSTRUCTION }
}
