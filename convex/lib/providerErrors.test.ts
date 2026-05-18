import { describe, expect, it } from "vitest"

import {
  parseRetryAfterMs,
  ProviderCapacityError,
  ProviderPermanentError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderTransientError
} from "./providerErrors"

describe("parseRetryAfterMs", () => {
  it("parses retry delay seconds", () => {
    expect(parseRetryAfterMs("3", 1000)).toBe(3000)
  })

  it("parses HTTP-date retry headers relative to now", () => {
    expect(parseRetryAfterMs(new Date(11000).toUTCString(), 1000)).toBe(10000)
  })

  it("returns undefined for missing retry headers", () => {
    expect(parseRetryAfterMs(undefined, 1000)).toBeUndefined()
  })

  it("returns undefined for invalid retry headers", () => {
    expect(parseRetryAfterMs("not-a-date", 1000)).toBeUndefined()
  })

  it("returns undefined for non-positive retry delay seconds", () => {
    expect(parseRetryAfterMs("0", 1000)).toBeUndefined()
    expect(parseRetryAfterMs("-1", 1000)).toBeUndefined()
  })

  it("returns undefined for current or past HTTP-date retry headers", () => {
    expect(parseRetryAfterMs(new Date(1000).toUTCString(), 1000)).toBeUndefined()
    expect(parseRetryAfterMs(new Date(0).toUTCString(), 1000)).toBeUndefined()
  })
})

describe("provider errors", () => {
  it("builds rate-limit errors with retry metadata", () => {
    const error = new ProviderRateLimitError({ keyId: "jina:1", provider: "jina", retryAfterMs: 60000 })

    expect(error.retryAfterMs).toBe(60000)
    expect(error.message).toBe("jina provider key jina:1 is rate limited")
  })

  it("builds quota errors with key metadata", () => {
    const error = new ProviderQuotaExhaustedError({ keyId: "jina:1", provider: "jina" })

    expect(error.provider).toBe("jina")
    expect(error.keyId).toBe("jina:1")
    expect(error.message).toBe("jina provider key jina:1 quota is exhausted")
  })

  it("keeps transient error messages generic", () => {
    const error = new ProviderTransientError({
      keyId: "jina:1",
      message: "api key sk-test raw response body question text chunk text",
      provider: "jina"
    })

    expect(error.provider).toBe("jina")
    expect(error.keyId).toBe("jina:1")
    expect(error.message).toBe("jina provider key jina:1 failed transiently")
    expect(error.message).not.toContain("sk-test")
    expect(error.message).not.toContain("question text")
    expect(error.message).not.toContain("chunk text")
  })

  it("keeps permanent error messages generic without key metadata", () => {
    const error = new ProviderPermanentError({
      message: "raw provider response body with user input text",
      provider: "jina"
    })

    expect(error.provider).toBe("jina")
    expect(error.keyId).toBeUndefined()
    expect(error.message).toBe("jina provider request failed permanently")
    expect(error.message).not.toContain("raw provider response")
    expect(error.message).not.toContain("user input")
  })

  it("builds capacity errors for provider-wide cooldowns", () => {
    const error = new ProviderCapacityError({ provider: "jina", retryAfterMs: 60000 })

    expect(error.provider).toBe("jina")
    expect(error.retryAfterMs).toBe(60000)
    expect(error.message).toBe("jina provider capacity is temporarily unavailable")
  })
})
