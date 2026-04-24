import { describe, expect, it } from "vitest"

import { canResolveViewerAsset } from "./assets"

describe("canResolveViewerAsset", () => {
  it("rejects stale assets when asset.isCurrent=false and document.status=ready", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: false },
        document: { status: "ready" }
      })
    ).toBe(false)
  })

  it("rejects assets from inactive documents when asset.isCurrent=true and document.status=inactive", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: true },
        document: { status: "inactive" }
      })
    ).toBe(false)
  })

  it("allows current assets on ready documents", () => {
    expect(
      canResolveViewerAsset({
        asset: { isCurrent: true },
        document: { status: "ready" }
      })
    ).toBe(true)
  })
})
