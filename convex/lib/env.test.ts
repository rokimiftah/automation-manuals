import { describe, expect, it } from "vitest"

import { getProviderEnv } from "./env"

describe("getProviderEnv", () => {
  it("trims configured values and falls back to default models", () => {
    expect(
      getProviderEnv({
        LLAMA_CLOUD_API_KEY: " llx-test-key ",
        MISTRAL_API_KEY: " mistral-test-key ",
        MISTRAL_CHAT_MODEL: " mistral-large-latest ",
        MISTRAL_EMBED_MODEL: " mistral-embed "
      })
    ).toEqual({
      llamaCloudApiKey: "llx-test-key",
      mistralApiKey: "mistral-test-key",
      mistralChatModel: "mistral-large-latest",
      mistralEmbedModel: "mistral-embed"
    })
  })

  it("throws when LLAMA_CLOUD_API_KEY is missing", () => {
    expect(() =>
      getProviderEnv({
        MISTRAL_API_KEY: "mistral-test-key"
      })
    ).toThrow("LLAMA_CLOUD_API_KEY is required")
  })
})
