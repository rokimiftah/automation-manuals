import type { ProviderName } from "./providerKeys"

type ProviderKeyErrorArgs = {
  keyId: string
  provider: ProviderName
}

type ProviderRetryKeyErrorArgs = ProviderKeyErrorArgs & {
  retryAfterMs: number | undefined
}

type ProviderMessageErrorArgs = {
  keyId?: string
  message?: string
  provider: ProviderName
}

type ProviderCapacityErrorArgs = {
  provider: ProviderName
  retryAfterMs: number | undefined
}

function formatProviderTarget({ keyId, provider }: { keyId?: string; provider: ProviderName }) {
  return keyId ? `${provider} provider key ${keyId}` : `${provider} provider request`
}

export function parseRetryAfterMs(value: string | undefined, now: number) {
  if (value === undefined) {
    return undefined
  }

  const header = value.trim()
  if (!header) {
    return undefined
  }

  const retryAfterSeconds = Number(header)
  if (Number.isFinite(retryAfterSeconds)) {
    return retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined
  }

  const retryAt = Date.parse(header)
  if (Number.isNaN(retryAt)) {
    return undefined
  }

  const delayMs = retryAt - now
  return delayMs > 0 ? delayMs : undefined
}

export class ProviderRateLimitError extends Error {
  readonly keyId: string
  readonly provider: ProviderName
  readonly retryAfterMs: number | undefined

  constructor(args: ProviderRetryKeyErrorArgs) {
    super(`${args.provider} provider key ${args.keyId} is rate limited`)
    this.name = "ProviderRateLimitError"
    this.keyId = args.keyId
    this.provider = args.provider
    this.retryAfterMs = args.retryAfterMs
  }
}

export class ProviderQuotaExhaustedError extends Error {
  readonly keyId: string
  readonly provider: ProviderName

  constructor(args: ProviderKeyErrorArgs) {
    super(`${args.provider} provider key ${args.keyId} quota is exhausted`)
    this.name = "ProviderQuotaExhaustedError"
    this.keyId = args.keyId
    this.provider = args.provider
  }
}

export class ProviderTransientError extends Error {
  readonly keyId: string | undefined
  readonly provider: ProviderName

  constructor(args: ProviderMessageErrorArgs) {
    super(`${formatProviderTarget(args)} failed transiently`)
    this.name = "ProviderTransientError"
    this.keyId = args.keyId
    this.provider = args.provider
  }
}

export class ProviderPermanentError extends Error {
  readonly keyId: string | undefined
  readonly provider: ProviderName

  constructor(args: ProviderMessageErrorArgs) {
    super(`${formatProviderTarget(args)} failed permanently`)
    this.name = "ProviderPermanentError"
    this.keyId = args.keyId
    this.provider = args.provider
  }
}

export class ProviderCapacityError extends Error {
  readonly provider: ProviderName
  readonly retryAfterMs: number | undefined

  constructor(args: ProviderCapacityErrorArgs) {
    super(`${args.provider} provider capacity is temporarily unavailable`)
    this.name = "ProviderCapacityError"
    this.provider = args.provider
    this.retryAfterMs = args.retryAfterMs
  }
}
