import type { Doc } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"

import { v } from "convex/values"

import { internalMutation } from "./_generated/server"

type Provider = "jina" | "inception"
type ProviderKeyState = Doc<"providerApiKeyStates">

const PROVIDER_RATE_WINDOW_MS = 60_000

const providerValidator = v.union(v.literal("jina"), v.literal("inception"))

const reserveProviderKeyResultValidator = v.union(
  v.object({ available: v.literal(true), keyId: v.string() }),
  v.object({ available: v.literal(false), retryAfterMs: v.number() })
)

function getWindowStart(now: number) {
  return now - (now % PROVIDER_RATE_WINDOW_MS)
}

function getNextWindowRetryAfterMs(now: number, windowStart: number) {
  return Math.max(1, windowStart + PROVIDER_RATE_WINDOW_MS - now)
}

function minRetryAfterMs(current: number | undefined, candidate: number) {
  const retryAfterMs = Math.max(1, candidate)
  return current === undefined ? retryAfterMs : Math.min(current, retryAfterMs)
}

function safeCount(value: number | undefined) {
  return Math.max(0, value ?? 0)
}

function releaseInFlightCount(state: ProviderKeyState) {
  return Math.max(0, state.inFlightCount - 1)
}

function reconcileTokenCount(current: number, reserved: number | undefined, actual: number | undefined) {
  if (actual === undefined) {
    return current
  }

  return Math.max(0, current - safeCount(reserved) + safeCount(actual))
}

function getActiveInFlightCount(state: ProviderKeyState | null, now: number) {
  if (!state) {
    return 0
  }

  return now - state.updatedAt > PROVIDER_RATE_WINDOW_MS ? 0 : state.inFlightCount
}

function sanitizeDisabledReason(reason: string) {
  return reason
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "[redacted]")
    .replace(/\b(?:api|inception|jina|sk)[A-Za-z0-9]*[-_][A-Za-z0-9_-]+\b/g, "[redacted]")
}

async function getProviderKeyState(ctx: Pick<MutationCtx, "db">, provider: Provider, keyId: string) {
  return await ctx.db
    .query("providerApiKeyStates")
    .withIndex("by_provider_and_key", (q) => q.eq("provider", provider).eq("keyId", keyId))
    .unique()
}

function getWindowCounts(state: ProviderKeyState | null, windowStart: number) {
  if (!state || state.windowStart !== windowStart) {
    return {
      inputTokenCount: 0,
      outputTokenCount: 0,
      requestCount: 0
    }
  }

  return {
    inputTokenCount: state.inputTokenCount,
    outputTokenCount: state.outputTokenCount,
    requestCount: state.requestCount
  }
}

async function insertProviderKeyState(
  ctx: Pick<MutationCtx, "db">,
  args: {
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
) {
  await ctx.db.insert("providerApiKeyStates", args)
}

export const reserveProviderKey = internalMutation({
  args: {
    provider: providerValidator,
    keyIds: v.array(v.string()),
    estimatedInputTokens: v.number(),
    estimatedOutputTokens: v.number(),
    estimatedRequestCount: v.optional(v.number()),
    rpmLimit: v.number(),
    inputTpmLimit: v.number(),
    outputTpmLimit: v.number(),
    maxConcurrent: v.number()
  },
  returns: reserveProviderKeyResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now()
    const windowStart = getWindowStart(now)
    const nextWindowRetryAfterMs = getNextWindowRetryAfterMs(now, windowStart)
    const estimatedInputTokens = safeCount(args.estimatedInputTokens)
    const estimatedOutputTokens = safeCount(args.estimatedOutputTokens)
    const estimatedRequestCount = Math.max(1, Math.floor(args.estimatedRequestCount ?? 1))
    let retryAfterMs: number | undefined

    for (const keyId of args.keyIds) {
      const state = await getProviderKeyState(ctx, args.provider, keyId)
      if (state?.disabledAt !== undefined) {
        continue
      }

      if (state?.cooldownUntil !== undefined && state.cooldownUntil > now) {
        retryAfterMs = minRetryAfterMs(retryAfterMs, state.cooldownUntil - now)
        continue
      }

      const counts = getWindowCounts(state, windowStart)
      if (counts.requestCount + estimatedRequestCount > args.rpmLimit) {
        retryAfterMs = minRetryAfterMs(retryAfterMs, nextWindowRetryAfterMs)
        continue
      }

      if (counts.inputTokenCount + estimatedInputTokens > args.inputTpmLimit) {
        retryAfterMs = minRetryAfterMs(retryAfterMs, nextWindowRetryAfterMs)
        continue
      }

      if (counts.outputTokenCount + estimatedOutputTokens > args.outputTpmLimit) {
        retryAfterMs = minRetryAfterMs(retryAfterMs, nextWindowRetryAfterMs)
        continue
      }

      const inFlightCount = getActiveInFlightCount(state, now)
      if (inFlightCount >= args.maxConcurrent) {
        continue
      }

      const reservation = {
        inFlightCount: inFlightCount + 1,
        inputTokenCount: counts.inputTokenCount + estimatedInputTokens,
        outputTokenCount: counts.outputTokenCount + estimatedOutputTokens,
        requestCount: counts.requestCount + estimatedRequestCount,
        updatedAt: now,
        windowStart
      }

      if (state) {
        await ctx.db.patch("providerApiKeyStates", state._id, reservation)
      } else {
        await insertProviderKeyState(ctx, {
          ...reservation,
          keyId,
          provider: args.provider
        })
      }

      return { available: true as const, keyId }
    }

    return { available: false as const, retryAfterMs: retryAfterMs ?? PROVIDER_RATE_WINDOW_MS }
  }
})

export const recordProviderSuccess = internalMutation({
  args: {
    provider: providerValidator,
    keyId: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reservedInputTokens: v.optional(v.number()),
    reservedOutputTokens: v.optional(v.number())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await getProviderKeyState(ctx, args.provider, args.keyId)
    if (!state) {
      return null
    }

    const now = Date.now()
    const windowStart = getWindowStart(now)
    const patch: Partial<ProviderKeyState> = {
      inFlightCount: releaseInFlightCount(state),
      updatedAt: now
    }

    if (state.windowStart === windowStart) {
      patch.inputTokenCount = reconcileTokenCount(state.inputTokenCount, args.reservedInputTokens, args.inputTokens)
      patch.outputTokenCount = reconcileTokenCount(state.outputTokenCount, args.reservedOutputTokens, args.outputTokens)
    }

    await ctx.db.patch("providerApiKeyStates", state._id, patch)
    return null
  }
})

export const recordProviderRateLimit = internalMutation({
  args: {
    provider: providerValidator,
    keyId: v.string(),
    retryAfterMs: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const windowStart = getWindowStart(now)
    const state = await getProviderKeyState(ctx, args.provider, args.keyId)
    const cooldownUntil = now + Math.max(1, args.retryAfterMs)

    if (!state) {
      await insertProviderKeyState(ctx, {
        cooldownUntil,
        inFlightCount: 0,
        inputTokenCount: 0,
        keyId: args.keyId,
        lastRateLimitedAt: now,
        outputTokenCount: 0,
        provider: args.provider,
        requestCount: 0,
        updatedAt: now,
        windowStart
      })
      return null
    }

    await ctx.db.patch("providerApiKeyStates", state._id, {
      cooldownUntil,
      inFlightCount: releaseInFlightCount(state),
      lastRateLimitedAt: now,
      updatedAt: now
    })
    return null
  }
})

export const recordProviderTransientFailure = internalMutation({
  args: {
    provider: providerValidator,
    keyId: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await getProviderKeyState(ctx, args.provider, args.keyId)
    if (!state) {
      return null
    }

    await ctx.db.patch("providerApiKeyStates", state._id, {
      inFlightCount: releaseInFlightCount(state),
      updatedAt: Date.now()
    })
    return null
  }
})

export const disableProviderKey = internalMutation({
  args: {
    provider: providerValidator,
    keyId: v.string(),
    reason: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const windowStart = getWindowStart(now)
    const state = await getProviderKeyState(ctx, args.provider, args.keyId)
    const disabledReason = sanitizeDisabledReason(args.reason)

    if (!state) {
      await insertProviderKeyState(ctx, {
        disabledAt: now,
        disabledReason,
        inFlightCount: 0,
        inputTokenCount: 0,
        keyId: args.keyId,
        outputTokenCount: 0,
        provider: args.provider,
        requestCount: 0,
        updatedAt: now,
        windowStart
      })
      return null
    }

    await ctx.db.patch("providerApiKeyStates", state._id, {
      disabledAt: now,
      disabledReason,
      inFlightCount: releaseInFlightCount(state),
      updatedAt: now
    })
    return null
  }
})

export const resetProviderKeyState = internalMutation({
  args: {
    provider: providerValidator,
    keyId: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await getProviderKeyState(ctx, args.provider, args.keyId)
    if (!state) {
      return null
    }

    await ctx.db.patch("providerApiKeyStates", state._id, {
      cooldownUntil: undefined,
      disabledAt: undefined,
      disabledReason: undefined,
      lastRateLimitedAt: undefined,
      updatedAt: Date.now()
    })
    return null
  }
})
