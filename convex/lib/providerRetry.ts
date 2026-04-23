import type { IngestionStatus } from "./ingestionState"

export const PROVIDER_RECONCILE_RETRY_LIMIT = 3
export const DEFAULT_PROVIDER_FAILURE_MESSAGE = "MinerU extraction failed"

export function getProviderReconcileDecision(currentFailureCount: number) {
  const nextFailureCount = currentFailureCount + 1

  return {
    nextFailureCount,
    shouldFail: nextFailureCount >= PROVIDER_RECONCILE_RETRY_LIMIT
  }
}

export function getProviderFailureMessage(providerErrorMessage?: string) {
  return providerErrorMessage || DEFAULT_PROVIDER_FAILURE_MESSAGE
}

type ProviderProgressPatchArgs = {
  providerDataId?: string
  providerErrorCode?: number
  providerErrorMessage?: string
  providerReconcileFailureCount?: number
  providerResultUrl?: string
  providerState: string
  providerTraceId?: string
  status: IngestionStatus
}

export function buildProviderProgressPatch(args: ProviderProgressPatchArgs, now: number) {
  return {
    ...(args.providerDataId === undefined ? {} : { providerDataId: args.providerDataId }),
    ...(args.providerErrorCode === undefined ? {} : { providerErrorCode: args.providerErrorCode }),
    ...(args.providerErrorMessage === undefined && args.providerState !== "failed"
      ? { providerErrorMessage: undefined }
      : args.providerErrorMessage === undefined
        ? {}
        : { providerErrorMessage: args.providerErrorMessage }),
    ...(args.providerReconcileFailureCount === undefined
      ? {}
      : { providerReconcileFailureCount: args.providerReconcileFailureCount }),
    ...(args.providerResultUrl === undefined ? {} : { providerResultUrl: args.providerResultUrl }),
    ...(args.providerTraceId === undefined ? {} : { providerTraceId: args.providerTraceId }),
    providerLastCheckedAt: now,
    providerState: args.providerState,
    status: args.status,
    updatedAt: now
  }
}
