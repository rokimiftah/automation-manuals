import type { ReactNode } from "react"

import { useEffect } from "react"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EvidenceViewer from "./EvidenceViewer"

// @vitest-environment jsdom

const useQuery = vi.fn()
let scrollTargets: HTMLElement[] = []
let scrollIntoViewDescriptor: PropertyDescriptor | undefined

const { documentMock, pageMock, workerState } = vi.hoisted(() => {
  const documentMock = vi.fn(
    ({ children, onLoadSuccess }: { children?: ReactNode; onLoadSuccess?: (result: { numPages: number }) => void }) => {
      useEffect(() => {
        onLoadSuccess?.({ numPages: 70 })
      }, [onLoadSuccess])

      return <div data-testid="pdf-document">{children}</div>
    }
  )
  const pageMock = vi.fn(({ pageNumber, width }: { pageNumber: number; width?: number }) => (
    <div data-page-number={pageNumber} data-testid="pdf-page-content" data-width={width} />
  ))
  const workerState = { workerSrc: "" }

  return { documentMock, pageMock, workerState }
})

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

vi.mock("react-pdf", () => ({
  Document: (props: { children?: ReactNode }) => documentMock(props),
  Page: (props: { pageNumber: number; width?: number }) => pageMock(props),
  pdfjs: { GlobalWorkerOptions: workerState }
}))

describe("EvidenceViewer", () => {
  beforeEach(() => {
    useQuery.mockReset()
    documentMock.mockReset()
    pageMock.mockReset()
    scrollTargets = []
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement) {
        scrollTargets.push(this)
      }
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 400,
      left: 0,
      right: 720,
      top: 0,
      toJSON: () => ({}),
      width: 720,
      x: 0,
      y: 0
    } as DOMRect)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
    }
  })

  it("renders all PDF pages so the viewer can scroll", async () => {
    useQuery.mockReturnValue({
      _id: "documentAssets_1",
      kind: "source_pdf",
      pageNumber: 54,
      url: "https://storage.example/manual.pdf"
    })

    render(
      <EvidenceViewer
        asset={{
          assetId: "documentAssets_1" as never,
          label: "Engine manual",
          pageNumber: 70
        }}
      />
    )

    expect(screen.getByText("Engine manual")).toBeInTheDocument()
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-file-url", "https://storage.example/manual.pdf")
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-page-number", "70")
    expect(useQuery.mock.calls[0]?.[1]).toEqual({
      assetId: "documentAssets_1",
      citationLabel: "Engine manual"
    })
    await screen.findAllByTestId("pdf-page")
    expect(documentMock).toHaveBeenCalled()
    expect(pageMock).toHaveBeenCalledTimes(70)
    expect(pageMock.mock.calls.map(([props]) => props.pageNumber)).toEqual(Array.from({ length: 70 }, (_, index) => index + 1))
    expect(scrollTargets[0]).toBe(screen.getAllByTestId("pdf-page")[69])
    expect(workerState.workerSrc).toContain("pdf.worker.min.mjs")
    expect(screen.queryByTitle("Engine manual")).not.toBeInTheDocument()
  })
})
