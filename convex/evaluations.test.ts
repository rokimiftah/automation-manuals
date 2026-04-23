import { describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"

// @ts-expect-error evaluations.list must remain internal-only
api.evaluations.list

describe("evaluations api visibility", () => {
  it("keeps the internal evaluations list reference available", () => {
    expect(internal.evaluations.list).toBeDefined()
  })
})
