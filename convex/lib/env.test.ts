import { describe, expect, it } from "vitest"

import { getProviderEnv } from "./env"

describe("getProviderEnv", () => {
  it("trims configured values and parses provider key lists", () => {
    expect(
      getProviderEnv({
        INCEPTION_API_KEYS: " inception-key-1, inception-key-2 ",
        INCEPTION_BASE_URL: " https://api.inceptionlabs.ai/v1 ",
        INCEPTION_CHAT_MODEL: " mercury-2 ",
        INCEPTION_INPUT_TPM_PER_KEY: " 90000 ",
        INCEPTION_MAX_CONCURRENT_PER_KEY: " 1 ",
        INCEPTION_MAX_TOKENS: " 8192 ",
        INCEPTION_OUTPUT_TPM_PER_KEY: " 8000 ",
        INCEPTION_REASONING_EFFORT: " medium ",
        INCEPTION_RPM_PER_KEY: " 90 ",
        INCEPTION_TEMPERATURE: " 0.75 ",
        JINA_API_KEYS: " jina-key-1, jina-key-2 ",
        JINA_EMBED_MODEL: " jina-embeddings-v5-text-small ",
        JINA_MAX_CONCURRENT_PER_KEY: " 2 ",
        JINA_RPM_PER_KEY: " 90 ",
        JINA_TPM_PER_KEY: " 90000 ",
        MINERU_CALLBACK_SEED: " callback-seed ",
        MINERU_CALLBACK_UID: " callback-uid ",
        MINERU_CALLBACK_URL: " https://app.example/providers/mineru/callback ",
        MINERU_DAILY_PRIORITY_PAGES: " 1000 ",
        MINERU_DAILY_FILE_LIMIT: " 5000 ",
        MINERU_SUBMIT_RATE_PER_MINUTE: " 50 ",
        MINERU_RESULT_QUERY_RATE_PER_MINUTE: " 1000 ",
        MINERU_API_TOKEN: " mineru-token "
      })
    ).toEqual({
      inceptionApiKeys: ["inception-key-1", "inception-key-2"],
      inceptionBaseUrl: "https://api.inceptionlabs.ai/v1",
      inceptionChatModel: "mercury-2",
      inceptionInputTpmPerKey: 90000,
      inceptionMaxConcurrentPerKey: 1,
      inceptionMaxTokens: 8192,
      inceptionOutputTpmPerKey: 8000,
      inceptionReasoningEffort: "medium",
      inceptionRpmPerKey: 90,
      inceptionTemperature: 0.75,
      jinaApiKeys: ["jina-key-1", "jina-key-2"],
      jinaEmbedModel: "jina-embeddings-v5-text-small",
      jinaMaxConcurrentPerKey: 2,
      jinaRpmPerKey: 90,
      jinaTpmPerKey: 90000,
      mineruApiToken: "mineru-token",
      mineruCallbackSeed: "callback-seed",
      mineruCallbackUid: "callback-uid",
      mineruCallbackUrl: "https://app.example/providers/mineru/callback",
      mineruDailyPriorityPages: 1000,
      mineruDailyFileLimit: 5000,
      mineruSubmitRatePerMinute: 50,
      mineruResultQueryRatePerMinute: 1000
    })
  })

  it("throws when MINERU_API_TOKEN is missing", () => {
    expect(() =>
      getProviderEnv({
        MINERU_CALLBACK_SEED: "callback-seed",
        INCEPTION_API_KEYS: "inception-test-key",
        JINA_API_KEYS: "jina-test-key"
      })
    ).toThrow("MINERU_API_TOKEN is required")
  })

  it("throws when JINA_API_KEYS is missing", () => {
    expect(() =>
      getProviderEnv({
        MINERU_API_TOKEN: "mineru",
        INCEPTION_API_KEYS: "inception"
      })
    ).toThrow("JINA_API_KEYS is required")
  })

  it("throws when INCEPTION_API_KEYS is missing", () => {
    expect(() =>
      getProviderEnv({
        MINERU_API_TOKEN: "mineru",
        JINA_API_KEYS: "jina"
      })
    ).toThrow("INCEPTION_API_KEYS is required")
  })

  it("allows polling-only configuration without callback settings", () => {
    const result = getProviderEnv({
      INCEPTION_API_KEYS: "inception-test-key",
      JINA_API_KEYS: "jina-test-key",
      MINERU_API_TOKEN: "mineru-token",
      INCEPTION_REASONING_EFFORT: "invalid",
      INCEPTION_TEMPERATURE: "0.25"
    })

    expect(result).toMatchObject({
      inceptionBaseUrl: "https://api.inceptionlabs.ai/v1",
      inceptionChatModel: "mercury-2",
      inceptionInputTpmPerKey: 90000,
      inceptionMaxConcurrentPerKey: 1,
      inceptionMaxTokens: 8192,
      inceptionOutputTpmPerKey: 9000,
      inceptionReasoningEffort: "medium",
      inceptionRpmPerKey: 90,
      inceptionTemperature: 0.75,
      jinaEmbedModel: "jina-embeddings-v5-text-small",
      jinaMaxConcurrentPerKey: 2,
      jinaRpmPerKey: 90,
      jinaTpmPerKey: 90000,
      mineruApiToken: "mineru-token"
    })
    expect(result.mineruCallbackSeed).toBeUndefined()
    expect(result.mineruCallbackUrl).toBeUndefined()
  })

  it("throws when a callback url is configured without a callback seed", () => {
    expect(() =>
      getProviderEnv({
        INCEPTION_API_KEYS: "inception-test-key",
        JINA_API_KEYS: "jina-test-key",
        MINERU_API_TOKEN: "mineru-token",
        MINERU_CALLBACK_URL: "https://app.example/providers/mineru/callback"
      })
    ).toThrow("MINERU_CALLBACK_SEED is required when MINERU_CALLBACK_URL is set")
  })

  it("throws when a callback url is configured without a callback uid", () => {
    expect(() =>
      getProviderEnv({
        INCEPTION_API_KEYS: "inception-test-key",
        JINA_API_KEYS: "jina-test-key",
        MINERU_API_TOKEN: "mineru-token",
        MINERU_CALLBACK_SEED: "callback-seed",
        MINERU_CALLBACK_URL: "https://app.example/providers/mineru/callback"
      })
    ).toThrow("MINERU_CALLBACK_UID is required when MINERU_CALLBACK_URL is set")
  })
})
