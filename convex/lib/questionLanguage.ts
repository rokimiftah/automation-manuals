export type ResponseLanguagePolicy = {
  instruction: string
}

export const DOMINANT_LANGUAGE_RESPONSE_INSTRUCTION =
  "Determine the response language from the user's question only, not from retrieved context, manual language, or the language of these system instructions. Answer every natural-language response field in the dominant language of the user's question. If the question mixes languages, use the dominant language. If retrieved context is in a different language, translate the answer into the target response language. Preserve the user's script. Do not default to English unless English is the dominant language of the user's question. If the user's question is not English, do not answer in English. Before returning JSON, verify that answerSummary, answerSteps, and clarifyingQuestion use the target response language. Do not translate citation labels, fault codes, model numbers, product names, vendor names, commands, parameter names, or code when translation could change meaning."

export function buildResponseLanguagePolicy(_question: string): ResponseLanguagePolicy {
  return { instruction: DOMINANT_LANGUAGE_RESPONSE_INSTRUCTION }
}
