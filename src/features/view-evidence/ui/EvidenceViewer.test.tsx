// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EvidenceViewer from "./EvidenceViewer"

const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

describe("EvidenceViewer", () => {
  beforeEach(() => {
    useQuery.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it("preserves direct PDF page targeting without extra iframe restrictions", () => {
    useQuery.mockReturnValue({
      _id: "documentAssets_1",
      kind: "source_pdf",
      url: "https://storage.example/manual.pdf"
    })

    render(
      <EvidenceViewer
        asset={{
          assetId: "documentAssets_1" as never,
          label: "Page 12",
          pageNumber: 12
        }}
      />
    )

    const frame = screen.getByTitle("Page 12")
    expect(frame).toHaveAttribute("src", "https://storage.example/manual.pdf#page=12")
    expect(frame).not.toHaveAttribute("referrerpolicy")
  })
})
