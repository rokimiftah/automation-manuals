import { describe, expect, it } from "vitest"

import { getProviderEnv } from "./env"

describe("getProviderEnv", () => {
  it("trims configured values and falls back to default models", () => {
    expect(
      getProviderEnv({
        MINERU_API_TOKEN: " mineru-token ",
        MINERU_CALLBACK_SEED: " callback-seed ",
        MINERU_CALLBACK_URL: " https://app.example/providers/mineru/callback ",
        MINERU_DAILY_PRIORITY_PAGES: " 1000 ",
        MINERU_DAILY_FILE_LIMIT: " 5000 ",
        MINERU_SUBMIT_RATE_PER_MINUTE: " 50 ",
        MINERU_RESULT_QUERY_RATE_PER_MINUTE: " 1000 ",
        MISTRAL_API_KEY: " mistral-test-key ",
        MISTRAL_CHAT_MODEL: " mistral-large-latest ",
        MISTRAL_EMBED_MODEL: " mistral-embed "
      })
    ).toEqual({
      mineruApiToken: "mineru-token",
      mineruCallbackSeed: "callback-seed",
      mineruCallbackUrl: "https://app.example/providers/mineru/callback",
      mineruDailyPriorityPages: 1000,
      mineruDailyFileLimit: 5000,
      mineruSubmitRatePerMinute: 50,
      mineruResultQueryRatePerMinute: 1000,
      mistralApiKey: "mistral-test-key",
      mistralChatModel: "mistral-large-latest",
      mistralEmbedModel: "mistral-embed"
    })
  })

  it("throws when MINERU_API_TOKEN is missing", () => {
    expect(() =>
      getProviderEnv({
        MINERU_CALLBACK_SEED: "callback-seed",
        MISTRAL_API_KEY: "mistral-test-key"
      })
    ).toThrow("MINERU_API_TOKEN is required")
  })

  it("allows polling-only configuration without callback settings", () => {
    const result = getProviderEnv({
      MINERU_API_TOKEN: "mineru-token",
      MISTRAL_API_KEY: "mistral-test-key"
    })

    expect(result).toMatchObject({
      mineruApiToken: "mineru-token",
    })
    expect(result.mineruCallbackSeed).toBeUndefined()
    expect(result.mineruCallbackUrl).toBeUndefined()
  })

  it("throws when a callback url is configured without a callback seed", () => {
    expect(() =>
      getProviderEnv({
        MINERU_API_TOKEN: "mineru-token",
        MINERU_CALLBACK_URL: "https://app.example/providers/mineru/callback",
        MISTRAL_API_KEY: "mistral-test-key"
      })
    ).toThrow("MINERU_CALLBACK_SEED is required when MINERU_CALLBACK_URL is set")
  })
})
