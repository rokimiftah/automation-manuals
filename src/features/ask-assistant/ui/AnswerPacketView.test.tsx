import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import AnswerPacketView from "./AnswerPacketView"

describe("AnswerPacketView", () => {
  it("emits citation selection", () => {
    const onSelect = vi.fn()

    render(
      <AnswerPacketView
        packet={{
          answerabilityStatus: "grounded",
          answerSummary: "Partner goes to the right.",
          answerSteps: ["Check the right-adjacent slot."],
          citations: [{ chunkId: "chunk-1" as never, pageNumber: 70, citationLabel: "Page 62", assetId: "asset-1" as never }],
          supportingAssets: [{ assetId: "asset-1" as never, pageNumber: 70, label: "Page 62" }]
        }}
        onSelectCitation={onSelect}
      />
    )

    expect(screen.getByText("Citation label")).toBeInTheDocument()
    expect(screen.getByText("PDF page")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /page 62/i }))

    expect(onSelect).toHaveBeenCalledWith({ assetId: "asset-1", pageNumber: 70, label: "Page 62" })
  })
})
