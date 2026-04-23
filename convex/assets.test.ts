import { describe, expect, it } from "vitest"

import { canResolveViewerAsset } from "./assets"

describe("canResolveViewerAsset", () => {
  it("rejects stale assets when asset.isCurrent=false and document.isActive=true", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: false },
        document: { isActive: true }
      })
    ).toBe(false)
  })

  it("rejects assets from inactive documents when asset.isCurrent=true and document.isActive=false", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: true },
        document: { isActive: false }
      })
    ).toBe(false)
  })

  it("allows current assets on active documents when both are true", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: true },
        document: { isActive: true }
      })
    ).toBe(true)
  })
})
