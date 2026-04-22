import { describe, expect, it } from "vitest"

import { getPublicAppEnv } from "./env"

describe("getPublicAppEnv", () => {
  it("returns normalized convexUrl and convexSiteUrl when both are present and trimmed", () => {
    expect(
      getPublicAppEnv({ CONVEX_URL: "  https://convex.example  ", CONVEX_SITE_URL: "  https://site.example  " })
    ).toEqual({ convexUrl: "https://convex.example", convexSiteUrl: "https://site.example" })
  })

  it("throws CONVEX_URL is required when missing", () => {
    expect(() => getPublicAppEnv({ CONVEX_SITE_URL: "https://site.example" })).toThrow("CONVEX_URL is required")
  })
})
