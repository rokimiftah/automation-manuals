import { describe, expect, it } from "vitest"

import {
  buildProviderProgressPatch,
  getProviderFailureMessage,
  getProviderReconcileDecision,
  PROVIDER_RECONCILE_RETRY_LIMIT
} from "./providerRetry"

describe("getProviderReconcileDecision", () => {
  it("increments failure counts below the retry ceiling", () => {
    expect(getProviderReconcileDecision(1)).toEqual({ nextFailureCount: 2, shouldFail: false })
  })

  it("marks the final allowed failure as terminal", () => {
    expect(getProviderReconcileDecision(PROVIDER_RECONCILE_RETRY_LIMIT - 1)).toEqual({
      nextFailureCount: PROVIDER_RECONCILE_RETRY_LIMIT,
      shouldFail: true
    })
  })
})

describe("buildProviderProgressPatch", () => {
  it("clears stale provider errors when reconciliation recovers", () => {
    const patch = buildProviderProgressPatch(
      {
        providerReconcileFailureCount: 0,
        providerState: "done",
        status: "downloading_result"
      },
      123
    )

    expect(patch).toHaveProperty("providerErrorMessage", undefined)
    expect(patch).toEqual({
      providerLastCheckedAt: 123,
      providerReconcileFailureCount: 0,
      providerState: "done",
      status: "downloading_result",
      updatedAt: 123
    })
  })

  it("preserves explicit reconciliation errors", () => {
    const patch = buildProviderProgressPatch(
      {
        providerErrorMessage: "Temporary provider timeout",
        providerReconcileFailureCount: 2,
        providerState: "processing",
        status: "processing_provider"
      },
      456
    )

    expect(patch).toHaveProperty("providerErrorMessage", "Temporary provider timeout")
    expect(patch).toEqual({
      providerErrorMessage: "Temporary provider timeout",
      providerLastCheckedAt: 456,
      providerReconcileFailureCount: 2,
      providerState: "processing",
      status: "processing_provider",
      updatedAt: 456
    })
  })

  it("preserves provider failure messages in failed states", () => {
    const patch = buildProviderProgressPatch(
      {
        providerErrorMessage: "MinerU extraction failed",
        providerReconcileFailureCount: 0,
        providerState: "failed",
        status: "processing_provider"
      },
      789
    )

    expect(patch).toHaveProperty("providerErrorMessage", "MinerU extraction failed")
    expect(patch).toEqual({
      providerErrorMessage: "MinerU extraction failed",
      providerLastCheckedAt: 789,
      providerReconcileFailureCount: 0,
      providerState: "failed",
      status: "processing_provider",
      updatedAt: 789
    })
  })
})

describe("getProviderFailureMessage", () => {
  it("uses the provider message when present", () => {
    expect(getProviderFailureMessage("MinerU extraction failed for this file")).toBe("MinerU extraction failed for this file")
  })

  it("falls back to the default provider failure message", () => {
    expect(getProviderFailureMessage(undefined)).toBe("MinerU extraction failed")
  })
})
