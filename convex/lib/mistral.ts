import { Mistral } from "@mistralai/mistralai"

import { getProviderEnv } from "./env"

type EmbeddingResponse = {
  data: Array<{
    embedding: number[]
  }>
}

type OcrResponse = {
  pages?: Array<{
    markdown?: string | null
  }> | null
}

type ChatMessageContent = unknown

type ChatResponse = {
  choices: Array<{
    message?: {
      content?: ChatMessageContent
    }
  }>
}

type MistralClientLike = {
  chat: {
    complete: (args: {
      messages: Array<{ content: string; role: "system" | "user" }>
      model: string
      responseFormat: { type: "json_object" }
    }) => Promise<ChatResponse>
  }
  embeddings: {
    create: (args: { inputs: string[]; model: string }) => Promise<EmbeddingResponse>
  }
  ocr: {
    process: (args: {
      document: {
        documentUrl: string
        type: "document_url"
      }
      model: string
      pages: number[]
      tableFormat: "markdown"
    }) => Promise<OcrResponse>
  }
}

type ProviderOptions = {
  client?: Partial<MistralClientLike>
  model?: string
}

function getMistralClient(): MistralClientLike {
  return new Mistral({ apiKey: getProviderEnv().mistralApiKey }) as unknown as MistralClientLike
}

function collectTextFromPart(part: unknown) {
  if (!part || typeof part !== "object") {
    return typeof part === "string" ? part : ""
  }

  if (typeof (part as { text?: unknown }).text === "string") {
    return (part as { text: string }).text
  }

  if (typeof (part as { content?: unknown }).content === "string") {
    return (part as { content: string }).content
  }

  if (typeof (part as { value?: unknown }).value === "string") {
    return (part as { value: string }).value
  }

  return ""
}

export function extractTextContent(content: ChatMessageContent) {
  if (typeof content === "string") {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content.map(collectTextFromPart).join("").trim()
  }

  return collectTextFromPart(content).trim()
}

function parseJsonResponse<T>(content: ChatMessageContent) {
  const jsonText = extractTextContent(content)
  if (!jsonText) {
    throw new Error("Mistral response did not contain JSON content")
  }

  try {
    return JSON.parse(jsonText) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error"
    throw new Error(`Failed to parse Mistral JSON response: ${message}`)
  }
}

export async function embedTexts(inputs: string[], options: ProviderOptions = {}) {
  if (inputs.length === 0) {
    return []
  }

  const client = (options.client ?? getMistralClient()) as MistralClientLike
  const model = options.model ?? getProviderEnv().mistralEmbedModel
  const result = await client.embeddings.create({ inputs, model })
  return result.data.map((item) => item.embedding)
}

export async function ocrPdfPage(sourceUrl: string, pageNumber: number, options: ProviderOptions = {}) {
  if (pageNumber < 1) {
    throw new Error("pageNumber must be greater than 0")
  }

  const client = (options.client ?? getMistralClient()) as MistralClientLike
  const model = options.model ?? "mistral-ocr-latest"
  const result = await client.ocr.process({
    document: {
      documentUrl: sourceUrl,
      type: "document_url"
    },
    model,
    pages: [pageNumber - 1],
    tableFormat: "markdown"
  })

  return result.pages?.[0]?.markdown?.trim() ?? ""
}

export async function generateGroundedAnswer(question: string, context: string, options: ProviderOptions = {}) {
  const client = (options.client ?? getMistralClient()) as MistralClientLike
  const model = options.model ?? getProviderEnv().mistralChatModel
  const response = await client.chat.complete({
    messages: [
      {
        content:
          "Use only the provided context. If the context is insufficient, say so and return an empty answerSteps array and an empty citationIds array. Return strict JSON with keys answerSummary, answerSteps, and citationIds.",
        role: "system"
      },
      {
        content: `Question: ${question}\n\nContext: ${context}`,
        role: "user"
      }
    ],
    model,
    responseFormat: { type: "json_object" }
  })

  const parsed = parseJsonResponse<{
    answerSteps?: unknown
    answerSummary?: unknown
    citationIds?: unknown
  }>(response.choices[0]?.message?.content)

  return {
    answerSteps: Array.isArray(parsed.answerSteps) ? parsed.answerSteps.filter((step): step is string => typeof step === "string") : [],
    answerSummary: typeof parsed.answerSummary === "string" ? parsed.answerSummary : "",
    citationIds: Array.isArray(parsed.citationIds) ? parsed.citationIds.filter((id): id is string => typeof id === "string") : []
  }
}
