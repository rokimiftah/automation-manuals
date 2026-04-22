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
          citations: [{ chunkId: "chunk-1" as never, pageNumber: 9, citationLabel: "Page 9", assetId: "asset-1" as never }],
          supportingAssets: [{ assetId: "asset-1" as never, pageNumber: 9, label: "Page 9" }]
        }}
        onSelectCitation={onSelect}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /page 9/i }))

    expect(onSelect).toHaveBeenCalledWith({ assetId: "asset-1", pageNumber: 9, label: "Page 9" })
  })
})
