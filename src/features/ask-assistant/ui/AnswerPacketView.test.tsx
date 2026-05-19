import "@testing-library/jest-dom/vitest"

import { createRequire } from "node:module"

import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import AnswerPacketView from "./AnswerPacketView"

if (typeof document === "undefined") {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require("jsdom") as {
    JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
  }
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" })
  const { window } = dom

  Object.assign(globalThis, {
    document: window.document,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    window
  })

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator
  })
}

afterEach(() => {
  cleanup()
})

describe("AnswerPacketView", () => {
  it("emits citation selection", () => {
    const onSelect = vi.fn()

    const view = render(
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

    expect(view.getByText("Citation label")).toBeInTheDocument()
    expect(view.getByText("PDF page")).toBeInTheDocument()

    fireEvent.click(view.getByRole("button", { name: /page 62/i }))

    expect(onSelect).toHaveBeenCalledWith({ assetId: "asset-1", pageNumber: 70, label: "Page 62" })
  })

  it("renders clarification packets without evidence controls", () => {
    const view = render(
      <AnswerPacketView
        packet={{
          answerabilityStatus: "needs_clarification",
          answerSummary: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
          answerSteps: [],
          citations: [],
          clarifyingQuestion: "Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.",
          interpretedProblem: "Installation fault F002 after first power-on.",
          supportingAssets: []
        }}
        onSelectCitation={vi.fn()}
      />
    )

    expect(view.getByText("Clarification Required")).toBeInTheDocument()
    expect(view.getByText("Installation fault F002 after first power-on.")).toBeInTheDocument()
    expect(
      view.getByText("Kode F002 dapat berbeda antar vendor atau model. Sebutkan vendor dan model drive/inverter.")
    ).toBeInTheDocument()
  })
})
