type ProviderEnvInput = Partial<
  Record<"LLAMA_CLOUD_API_KEY" | "MISTRAL_API_KEY" | "MISTRAL_CHAT_MODEL" | "MISTRAL_EMBED_MODEL", string | undefined>
>

export type ProviderEnv = {
  llamaCloudApiKey: string
  mistralApiKey: string
  mistralChatModel: string
  mistralEmbedModel: string
}

function requireEnv(name: keyof ProviderEnvInput, value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${name} is required`)
  }

  return trimmed
}

export function getProviderEnv(input: ProviderEnvInput = process.env) {
  return {
    llamaCloudApiKey: requireEnv("LLAMA_CLOUD_API_KEY", input.LLAMA_CLOUD_API_KEY),
    mistralApiKey: requireEnv("MISTRAL_API_KEY", input.MISTRAL_API_KEY),
    mistralChatModel: input.MISTRAL_CHAT_MODEL?.trim() || "mistral-small-latest",
    mistralEmbedModel: input.MISTRAL_EMBED_MODEL?.trim() || "mistral-embed"
  } satisfies ProviderEnv
}
