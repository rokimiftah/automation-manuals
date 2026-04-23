import { describe, expect, it } from "vitest"

import { getPublicAppEnv } from "./env"

describe("getPublicAppEnv", () => {
  it("returns a trimmed convexUrl", () => {
    expect(getPublicAppEnv({ CONVEX_URL: "  https://convex.example  " })).toEqual({
      convexUrl: "https://convex.example"
    })
  })

  it("throws when CONVEX_URL is missing", () => {
    expect(() => getPublicAppEnv({})).toThrow("CONVEX_URL is required")
  })
})
