type ProviderEnvInput = Partial<
  Record<
    | "MINERU_API_TOKEN"
    | "MINERU_CALLBACK_SEED"
    | "MINERU_CALLBACK_UID"
    | "MINERU_CALLBACK_URL"
    | "MINERU_DAILY_PRIORITY_PAGES"
    | "MINERU_DAILY_FILE_LIMIT"
    | "MINERU_SUBMIT_RATE_PER_MINUTE"
    | "MINERU_RESULT_QUERY_RATE_PER_MINUTE"
    | "JINA_API_KEYS"
    | "JINA_EMBED_MODEL"
    | "JINA_RPM_PER_KEY"
    | "JINA_TPM_PER_KEY"
    | "JINA_MAX_CONCURRENT_PER_KEY"
    | "INCEPTION_API_KEYS"
    | "INCEPTION_BASE_URL"
    | "INCEPTION_CHAT_MODEL"
    | "INCEPTION_MAX_TOKENS"
    | "INCEPTION_REASONING_EFFORT"
    | "INCEPTION_TEMPERATURE"
    | "INCEPTION_RPM_PER_KEY"
    | "INCEPTION_INPUT_TPM_PER_KEY"
    | "INCEPTION_OUTPUT_TPM_PER_KEY"
    | "INCEPTION_MAX_CONCURRENT_PER_KEY",
    string | undefined
  >
>

type InceptionReasoningEffort = "instant" | "low" | "medium" | "high"

export type ProviderEnv = {
  mineruApiToken: string
  mineruCallbackSeed?: string
  mineruCallbackUid?: string
  mineruCallbackUrl?: string
  mineruDailyPriorityPages: number
  mineruDailyFileLimit: number
  mineruSubmitRatePerMinute: number
  mineruResultQueryRatePerMinute: number
  jinaApiKeys: string[]
  jinaEmbedModel: string
  jinaRpmPerKey: number
  jinaTpmPerKey: number
  jinaMaxConcurrentPerKey: number
  inceptionApiKeys: string[]
  inceptionBaseUrl: string
  inceptionChatModel: string
  inceptionMaxTokens: number
  inceptionReasoningEffort: InceptionReasoningEffort
  inceptionTemperature: number
  inceptionRpmPerKey: number
  inceptionInputTpmPerKey: number
  inceptionOutputTpmPerKey: number
  inceptionMaxConcurrentPerKey: number
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

function stringEnv(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function keyListEnv(name: keyof ProviderEnvInput, value: string | undefined) {
  const keys =
    value
      ?.split(",")
      .map((key) => key.trim())
      .filter(Boolean) ?? []

  if (keys.length === 0) {
    throw new Error(`${name} is required`)
  }

  return keys
}

function numberEnv(value: string | undefined, fallback: number) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

function inceptionReasoningEffortEnv(value: string | undefined): InceptionReasoningEffort {
  const trimmed = value?.trim()

  switch (trimmed) {
    case "instant":
    case "low":
    case "medium":
    case "high":
      return trimmed
    default:
      return "medium"
  }
}

function inceptionTemperatureEnv(value: string | undefined) {
  const temperature = numberEnv(value, 0.75)
  return temperature >= 0.5 && temperature <= 1 ? temperature : 0.75
}

export function getProviderEnv(input: ProviderEnvInput = process.env) {
  const mineruCallbackUrl = optionalEnv(input.MINERU_CALLBACK_URL)
  const mineruCallbackSeed = optionalEnv(input.MINERU_CALLBACK_SEED)
  const mineruCallbackUid = optionalEnv(input.MINERU_CALLBACK_UID)
  if (mineruCallbackUrl && !mineruCallbackSeed) {
    throw new Error("MINERU_CALLBACK_SEED is required when MINERU_CALLBACK_URL is set")
  }
  if (mineruCallbackUrl && !mineruCallbackUid) {
    throw new Error("MINERU_CALLBACK_UID is required when MINERU_CALLBACK_URL is set")
  }

  return {
    mineruApiToken: requireEnv("MINERU_API_TOKEN", input.MINERU_API_TOKEN),
    ...(mineruCallbackSeed === undefined ? {} : { mineruCallbackSeed }),
    ...(mineruCallbackUid === undefined ? {} : { mineruCallbackUid }),
    ...(mineruCallbackUrl === undefined ? {} : { mineruCallbackUrl }),
    mineruDailyPriorityPages: numberEnv(input.MINERU_DAILY_PRIORITY_PAGES, 1000),
    mineruDailyFileLimit: numberEnv(input.MINERU_DAILY_FILE_LIMIT, 5000),
    mineruSubmitRatePerMinute: numberEnv(input.MINERU_SUBMIT_RATE_PER_MINUTE, 50),
    mineruResultQueryRatePerMinute: numberEnv(input.MINERU_RESULT_QUERY_RATE_PER_MINUTE, 1000),
    jinaApiKeys: keyListEnv("JINA_API_KEYS", input.JINA_API_KEYS),
    jinaEmbedModel: stringEnv(input.JINA_EMBED_MODEL, "jina-embeddings-v5-text-small"),
    jinaRpmPerKey: numberEnv(input.JINA_RPM_PER_KEY, 90),
    jinaTpmPerKey: numberEnv(input.JINA_TPM_PER_KEY, 90000),
    jinaMaxConcurrentPerKey: numberEnv(input.JINA_MAX_CONCURRENT_PER_KEY, 2),
    inceptionApiKeys: keyListEnv("INCEPTION_API_KEYS", input.INCEPTION_API_KEYS),
    inceptionBaseUrl: stringEnv(input.INCEPTION_BASE_URL, "https://api.inceptionlabs.ai/v1"),
    inceptionChatModel: stringEnv(input.INCEPTION_CHAT_MODEL, "mercury-2"),
    inceptionMaxTokens: numberEnv(input.INCEPTION_MAX_TOKENS, 8192),
    inceptionReasoningEffort: inceptionReasoningEffortEnv(input.INCEPTION_REASONING_EFFORT),
    inceptionTemperature: inceptionTemperatureEnv(input.INCEPTION_TEMPERATURE),
    inceptionRpmPerKey: numberEnv(input.INCEPTION_RPM_PER_KEY, 90),
    inceptionInputTpmPerKey: numberEnv(input.INCEPTION_INPUT_TPM_PER_KEY, 90000),
    inceptionOutputTpmPerKey: numberEnv(input.INCEPTION_OUTPUT_TPM_PER_KEY, 9000),
    inceptionMaxConcurrentPerKey: numberEnv(input.INCEPTION_MAX_CONCURRENT_PER_KEY, 1)
  } satisfies ProviderEnv
}
