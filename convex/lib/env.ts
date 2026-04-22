type ProviderEnvInput = Partial<
  Record<
    | "MINERU_API_TOKEN"
    | "MINERU_CALLBACK_SEED"
    | "MINERU_CALLBACK_URL"
    | "MINERU_DAILY_PRIORITY_PAGES"
    | "MINERU_DAILY_FILE_LIMIT"
    | "MINERU_SUBMIT_RATE_PER_MINUTE"
    | "MINERU_RESULT_QUERY_RATE_PER_MINUTE"
    | "MISTRAL_API_KEY"
    | "MISTRAL_CHAT_MODEL"
    | "MISTRAL_EMBED_MODEL",
    string | undefined
  >
>

export type ProviderEnv = {
  mineruApiToken: string
  mineruCallbackSeed?: string
  mineruCallbackUrl?: string
  mineruDailyPriorityPages: number
  mineruDailyFileLimit: number
  mineruSubmitRatePerMinute: number
  mineruResultQueryRatePerMinute: number
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

function optionalEnv(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function numberEnv(value: string | undefined, fallback: number) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getProviderEnv(input: ProviderEnvInput = process.env) {
  const mineruCallbackUrl = optionalEnv(input.MINERU_CALLBACK_URL)
  const mineruCallbackSeed = optionalEnv(input.MINERU_CALLBACK_SEED)
  if (mineruCallbackUrl && !mineruCallbackSeed) {
    throw new Error("MINERU_CALLBACK_SEED is required when MINERU_CALLBACK_URL is set")
  }

  return {
    mineruApiToken: requireEnv("MINERU_API_TOKEN", input.MINERU_API_TOKEN),
    ...(mineruCallbackSeed === undefined ? {} : { mineruCallbackSeed }),
    ...(mineruCallbackUrl === undefined ? {} : { mineruCallbackUrl }),
    mineruDailyPriorityPages: numberEnv(input.MINERU_DAILY_PRIORITY_PAGES, 1000),
    mineruDailyFileLimit: numberEnv(input.MINERU_DAILY_FILE_LIMIT, 5000),
    mineruSubmitRatePerMinute: numberEnv(input.MINERU_SUBMIT_RATE_PER_MINUTE, 50),
    mineruResultQueryRatePerMinute: numberEnv(input.MINERU_RESULT_QUERY_RATE_PER_MINUTE, 1000),
    mistralApiKey: requireEnv("MISTRAL_API_KEY", input.MISTRAL_API_KEY),
    mistralChatModel: input.MISTRAL_CHAT_MODEL?.trim() || "mistral-small-latest",
    mistralEmbedModel: input.MISTRAL_EMBED_MODEL?.trim() || "mistral-embed"
  } satisfies ProviderEnv
}
