import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  disableProviderKey,
  recordProviderRateLimit,
  recordProviderSuccess,
  recordProviderTransientFailure,
  reserveProviderKey,
  resetProviderKeyState
} from "./providerRateLimits"

type Provider = "jina" | "inception"

type ProviderKeyState = {
  _creationTime: number
  _id: string
  cooldownUntil?: number
  disabledAt?: number
  disabledReason?: string
  inFlightCount: number
  inputTokenCount: number
  keyId: string
  lastRateLimitedAt?: number
  outputTokenCount: number
  provider: Provider
  requestCount: number
  updatedAt: number
  windowStart: number
}

type ReserveArgs = {
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedRequestCount?: number
  inputTpmLimit: number
  keyIds: string[]
  maxConcurrent: number
  outputTpmLimit: number
  provider: Provider
  rpmLimit: number
}

type ReserveResult = { available: true; keyId: string } | { available: false; retryAfterMs: number }

const reserveProviderKeyHandler = reserveProviderKey as typeof reserveProviderKey & {
  _handler: (ctx: unknown, args: ReserveArgs) => Promise<ReserveResult>
}

const recordProviderSuccessHandler = recordProviderSuccess as typeof recordProviderSuccess & {
  _handler: (
    ctx: unknown,
    args: {
      inputTokens?: number
      keyId: string
      outputTokens?: number
      provider: Provider
      reservedInputTokens?: number
      reservedOutputTokens?: number
    }
  ) => Promise<null>
}

const recordProviderRateLimitHandler = recordProviderRateLimit as typeof recordProviderRateLimit & {
  _handler: (ctx: unknown, args: { keyId: string; provider: Provider; retryAfterMs: number }) => Promise<null>
}

const recordProviderTransientFailureHandler = recordProviderTransientFailure as typeof recordProviderTransientFailure & {
  _handler: (ctx: unknown, args: { keyId: string; provider: Provider }) => Promise<null>
}

const disableProviderKeyHandler = disableProviderKey as typeof disableProviderKey & {
  _handler: (ctx: unknown, args: { keyId: string; provider: Provider; reason: string }) => Promise<null>
}

const resetProviderKeyStateHandler = resetProviderKeyState as typeof resetProviderKeyState & {
  _handler: (ctx: unknown, args: { keyId: string; provider: Provider }) => Promise<null>
}

const NOW = 120_005
const WINDOW_START = 120_000

function providerState(overrides: Partial<ProviderKeyState>): ProviderKeyState {
  return {
    _creationTime: 1,
    _id: overrides._id ?? `${overrides.provider ?? "jina"}:${overrides.keyId ?? "1"}`,
    inFlightCount: 0,
    inputTokenCount: 0,
    keyId: "jina:1",
    outputTokenCount: 0,
    provider: "jina",
    requestCount: 0,
    updatedAt: WINDOW_START,
    windowStart: WINDOW_START,
    ...overrides
  }
}

function createProviderStateCtx(initialRows: ProviderKeyState[] = []) {
  const rows = initialRows.map((row) => ({ ...row }))
  const insertedRows: ProviderKeyState[] = []
  const patchedRows: Array<{ id: string; patch: Partial<ProviderKeyState>; table: string }> = []

  const insert = vi.fn(async (table: string, value: Omit<ProviderKeyState, "_creationTime" | "_id">) => {
    if (table !== "providerApiKeyStates") {
      throw new Error(`Unexpected insert table ${table}`)
    }

    const row = {
      _creationTime: NOW,
      _id: `providerApiKeyStates_${rows.length + 1}`,
      ...value
    }

    rows.push(row)
    insertedRows.push(row)
    return row._id
  })

  const patch = vi.fn(async (table: string, id: string, value: Partial<ProviderKeyState>) => {
    if (table !== "providerApiKeyStates") {
      throw new Error(`Unexpected patch table ${table}`)
    }

    const row = rows.find((candidate) => candidate._id === id)
    if (!row) {
      throw new Error(`Missing provider state ${id}`)
    }

    Object.assign(row, value)
    patchedRows.push({ id, patch: value, table })
  })

  const query = vi.fn((table: string) => {
    if (table !== "providerApiKeyStates") {
      throw new Error(`Unexpected query table ${table}`)
    }

    return {
      withIndex: vi.fn((_index: string, buildRange: (q: { eq: (field: string, value: unknown) => unknown }) => void) => {
        const filters: Array<[string, unknown]> = []
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value])
            return builder
          }
        }

        buildRange(builder)

        const matches = rows.filter((row) => filters.every(([field, value]) => row[field as keyof ProviderKeyState] === value))

        return {
          collect: vi.fn(async () => matches),
          unique: vi.fn(async () => matches[0] ?? null)
        }
      })
    }
  })

  return {
    ctx: { db: { insert, patch, query } },
    insertedRows,
    patchedRows,
    rows
  }
}

function reserveArgs(overrides: Partial<ReserveArgs> = {}): ReserveArgs {
  return {
    estimatedInputTokens: 10,
    estimatedOutputTokens: 5,
    inputTpmLimit: 100,
    keyIds: ["jina:1", "jina:2"],
    maxConcurrent: 2,
    outputTpmLimit: 100,
    provider: "jina",
    rpmLimit: 2,
    ...overrides
  }
}

describe("provider rate limits", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date, "now").mockReturnValue(NOW)
  })

  it("reserves the first non-disabled Jina key", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({ _id: "state_1", disabledAt: NOW - 1, keyId: "jina:1" }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs())

    expect(result).toEqual({ available: true, keyId: "jina:2" })
    expect(rows[1]).toMatchObject({ inFlightCount: 1, inputTokenCount: 10, outputTokenCount: 5, requestCount: 1 })
  })

  it("creates provider state when reserving a missing key id", async () => {
    const { ctx, insertedRows } = createProviderStateCtx()

    const result = await reserveProviderKeyHandler._handler(
      ctx as never,
      reserveArgs({ estimatedInputTokens: 37, estimatedOutputTokens: 13, keyIds: ["jina:1"] })
    )

    expect(result).toEqual({ available: true, keyId: "jina:1" })
    expect(insertedRows[0]).toMatchObject({
      inFlightCount: 1,
      inputTokenCount: 37,
      keyId: "jina:1",
      outputTokenCount: 13,
      provider: "jina",
      requestCount: 1,
      updatedAt: NOW,
      windowStart: WINDOW_START
    })
    expect(JSON.stringify(insertedRows)).not.toContain("jina-key-1")
  })

  it("skips a key cooling down after a provider rate limit", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({ _id: "state_1", cooldownUntil: NOW + 1_000, keyId: "jina:1" }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs())

    expect(result).toEqual({ available: true, keyId: "jina:2" })
    expect(rows[0]).toMatchObject({ cooldownUntil: NOW + 1_000, inFlightCount: 0, requestCount: 0 })
  })

  it("skips a key at the request limit until the next minute window", async () => {
    const { ctx } = createProviderStateCtx([
      providerState({ _id: "state_1", keyId: "jina:1", requestCount: 2 }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ rpmLimit: 2 }))

    expect(result).toEqual({ available: true, keyId: "jina:2" })
  })

  it("resets stale window counters before reserving capacity", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({
        _id: "state_1",
        inputTokenCount: 99,
        outputTokenCount: 99,
        requestCount: 99,
        windowStart: WINDOW_START - 60_000
      })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ keyIds: ["jina:1"] }))

    expect(result).toEqual({ available: true, keyId: "jina:1" })
    expect(rows[0]).toMatchObject({
      inputTokenCount: 10,
      outputTokenCount: 5,
      requestCount: 1,
      windowStart: WINDOW_START
    })
  })

  it("accounts for actions that make multiple provider requests", async () => {
    const { ctx, rows } = createProviderStateCtx([providerState({ _id: "state_1", keyId: "jina:1", requestCount: 1 })])

    const result = await reserveProviderKeyHandler._handler(
      ctx as never,
      reserveArgs({ estimatedRequestCount: 2, keyIds: ["jina:1"], rpmLimit: 3 })
    )

    expect(result).toEqual({ available: true, keyId: "jina:1" })
    expect(rows[0]).toMatchObject({ requestCount: 3 })
  })

  it("skips a key when multiple provider requests would exceed RPM", async () => {
    const { ctx } = createProviderStateCtx([
      providerState({ _id: "state_1", keyId: "jina:1", requestCount: 1 }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ estimatedRequestCount: 2, rpmLimit: 2 }))

    expect(result).toEqual({ available: true, keyId: "jina:2" })
  })

  it("skips a key that would exceed the input token minute limit", async () => {
    const { ctx } = createProviderStateCtx([
      providerState({ _id: "state_1", inputTokenCount: 95, keyId: "jina:1" }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ estimatedInputTokens: 10 }))

    expect(result).toEqual({ available: true, keyId: "jina:2" })
  })

  it("skips a key that would exceed the output token minute limit", async () => {
    const { ctx } = createProviderStateCtx([
      providerState({ _id: "state_1", keyId: "jina:1", outputTokenCount: 96 }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ estimatedOutputTokens: 5 }))

    expect(result).toEqual({ available: true, keyId: "jina:2" })
  })

  it("skips a key at the per-key concurrency limit", async () => {
    const { ctx } = createProviderStateCtx([
      providerState({ _id: "state_1", inFlightCount: 2, keyId: "jina:1" }),
      providerState({ _id: "state_2", keyId: "jina:2" })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ maxConcurrent: 2 }))

    expect(result).toEqual({ available: true, keyId: "jina:2" })
  })

  it("resets stale in-flight count before checking concurrency", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({ _id: "state_1", inFlightCount: 2, keyId: "jina:1", updatedAt: NOW - 60_001 })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ keyIds: ["jina:1"], maxConcurrent: 2 }))

    expect(result).toEqual({ available: true, keyId: "jina:1" })
    expect(rows[0]).toMatchObject({ inFlightCount: 1, inputTokenCount: 10, outputTokenCount: 5, requestCount: 1 })
  })

  it("returns the earliest retry delay when all keys are skipped", async () => {
    const { ctx } = createProviderStateCtx([
      providerState({ _id: "state_1", cooldownUntil: NOW + 15_000, keyId: "jina:1" }),
      providerState({ _id: "state_2", keyId: "jina:2", requestCount: 2 })
    ])

    const result = await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ rpmLimit: 2 }))

    expect(result).toEqual({ available: false, retryAfterMs: 15_000 })
  })

  it("records success by releasing in-flight count and accounting actual usage", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({ _id: "state_1", inFlightCount: 2, inputTokenCount: 10, outputTokenCount: 5 })
    ])

    await expect(
      recordProviderSuccessHandler._handler(ctx as never, {
        inputTokens: 12,
        keyId: "jina:1",
        outputTokens: 7,
        provider: "jina"
      })
    ).resolves.toBeNull()

    expect(rows[0]).toMatchObject({ inFlightCount: 1, inputTokenCount: 22, outputTokenCount: 12, updatedAt: NOW })
  })

  it("reconciles reserved token estimates with actual success usage", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({ _id: "state_1", inFlightCount: 1, inputTokenCount: 900, outputTokenCount: 8192 })
    ])

    await expect(
      recordProviderSuccessHandler._handler(ctx as never, {
        inputTokens: 220,
        keyId: "jina:1",
        outputTokens: 34,
        provider: "jina",
        reservedInputTokens: 900,
        reservedOutputTokens: 8192
      })
    ).resolves.toBeNull()

    expect(rows[0]).toMatchObject({ inFlightCount: 0, inputTokenCount: 220, outputTokenCount: 34, updatedAt: NOW })
  })

  it("records provider rate limits by setting cooldown and releasing in-flight count", async () => {
    const { ctx, rows } = createProviderStateCtx([providerState({ _id: "state_1", inFlightCount: 2 })])

    await expect(
      recordProviderRateLimitHandler._handler(ctx as never, { keyId: "jina:1", provider: "jina", retryAfterMs: 30_000 })
    ).resolves.toBeNull()

    expect(rows[0]).toMatchObject({
      cooldownUntil: NOW + 30_000,
      inFlightCount: 1,
      lastRateLimitedAt: NOW,
      updatedAt: NOW
    })
  })

  it("records transient failures by releasing in-flight count without disabling the key", async () => {
    const { ctx, rows } = createProviderStateCtx([providerState({ _id: "state_1", inFlightCount: 1 })])

    await expect(
      recordProviderTransientFailureHandler._handler(ctx as never, { keyId: "jina:1", provider: "jina" })
    ).resolves.toBeNull()

    expect(rows[0].disabledAt).toBeUndefined()
    expect(rows[0].disabledReason).toBeUndefined()
    expect(rows[0]).toMatchObject({ inFlightCount: 0, updatedAt: NOW })
  })

  it("disables a key with a sanitized reason and releases in-flight count", async () => {
    const { ctx, patchedRows, rows } = createProviderStateCtx([providerState({ _id: "state_1", inFlightCount: 1 })])

    await expect(
      disableProviderKeyHandler._handler(ctx as never, {
        keyId: "jina:1",
        provider: "jina",
        reason: "quota exhausted for jina-key-1"
      })
    ).resolves.toBeNull()

    expect(rows[0]).toMatchObject({ disabledAt: NOW, disabledReason: "quota exhausted for [redacted]", inFlightCount: 0 })
    expect(JSON.stringify(patchedRows)).not.toContain("jina-key-1")
  })

  it("redacts underscore-style key-like values from disabled reasons", async () => {
    const { ctx, rows } = createProviderStateCtx([providerState({ _id: "state_1" })])

    await expect(
      disableProviderKeyHandler._handler(ctx as never, {
        keyId: "jina:1",
        provider: "jina",
        reason: "quota exhausted for jina_key_1 and inception_key_1"
      })
    ).resolves.toBeNull()

    expect(rows[0].disabledReason).toBe("quota exhausted for [redacted] and [redacted]")
    expect(rows[0].disabledReason).not.toContain("jina_key_1")
    expect(rows[0].disabledReason).not.toContain("inception_key_1")
  })

  it("redacts bearer-token strings from disabled reasons", async () => {
    const { ctx, rows } = createProviderStateCtx([providerState({ _id: "state_1" })])

    await expect(
      disableProviderKeyHandler._handler(ctx as never, {
        keyId: "jina:1",
        provider: "jina",
        reason: "provider rejected Bearer sk_live_secret after quota check"
      })
    ).resolves.toBeNull()

    expect(rows[0].disabledReason).toBe("provider rejected [redacted] after quota check")
    expect(rows[0].disabledReason).not.toContain("Bearer sk_live_secret")
    expect(rows[0].disabledReason).not.toContain("sk_live_secret")
  })

  it("resets cooldown and disabled state for operator recovery", async () => {
    const { ctx, rows } = createProviderStateCtx([
      providerState({
        _id: "state_1",
        cooldownUntil: NOW + 10_000,
        disabledAt: NOW - 10,
        disabledReason: "quota exhausted",
        lastRateLimitedAt: NOW - 5
      })
    ])

    await expect(resetProviderKeyStateHandler._handler(ctx as never, { keyId: "jina:1", provider: "jina" })).resolves.toBeNull()

    expect(rows[0].cooldownUntil).toBeUndefined()
    expect(rows[0].disabledAt).toBeUndefined()
    expect(rows[0].disabledReason).toBeUndefined()
    expect(rows[0].lastRateLimitedAt).toBeUndefined()
    expect(rows[0].updatedAt).toBe(NOW)
  })

  it("never writes raw API key strings to provider state rows", async () => {
    const { ctx, insertedRows, patchedRows } = createProviderStateCtx()

    await reserveProviderKeyHandler._handler(ctx as never, reserveArgs({ keyIds: ["jina:1"] }))
    await disableProviderKeyHandler._handler(ctx as never, {
      keyId: "jina:1",
      provider: "jina",
      reason: "operator saw jina-key-1 in provider output"
    })

    const persistedWrites = JSON.stringify({ insertedRows, patchedRows })
    expect(persistedWrites).not.toContain("jina-key-1")
  })
})
