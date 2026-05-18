import { describe, expect, it } from "vitest"

import { buildProviderKeyPool, resolveProviderKey } from "./providerKeys"

describe("buildProviderKeyPool", () => {
  it("builds stable one-based Jina key ids from trimmed keys", () => {
    expect(buildProviderKeyPool("jina", [" key-a ", "key-b"])).toEqual([
      { id: "jina:1", secret: "key-a" },
      { id: "jina:2", secret: "key-b" }
    ])
  })

  it("throws the provider env error when Inception keys are empty", () => {
    expect(() => buildProviderKeyPool("inception", [])).toThrow("INCEPTION_API_KEYS is required")
  })
})

describe("resolveProviderKey", () => {
  it("returns the matching provider secret", () => {
    expect(resolveProviderKey(buildProviderKeyPool("jina", ["key-a"]), "jina:1")).toBe("key-a")
  })

  it("throws when the provider key id is not configured", () => {
    expect(() => resolveProviderKey(buildProviderKeyPool("jina", ["key-a"]), "jina:2")).toThrow(
      "Provider key jina:2 is not configured"
    )
  })
})
