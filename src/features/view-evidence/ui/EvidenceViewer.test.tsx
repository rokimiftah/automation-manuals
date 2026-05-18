import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EvidenceViewer from "./EvidenceViewer"

// @vitest-environment jsdom

const useQuery = vi.fn()
let scrollTargets: HTMLElement[] = []
let scrollIntoViewDescriptor: PropertyDescriptor | undefined

const { getDocumentMock, getPageMock, renderCalls, renderTaskCancelMock, workerState, pdfjsState } = vi.hoisted(() => {
  const workerState = { workerSrc: "" }
  const pdfjsState: {
    documentFailure: string | null
    renderFailure: string | null
  } = {
    documentFailure: null,
    renderFailure: null
  }
  const renderCalls: Array<{
    canvasHeight: number
    canvasWidth: number
    pageNumber: number
    transform?: unknown
    viewportWidth: number
  }> = []
  const renderTaskCancelMock = vi.fn()
  const getPageMock = vi.fn((pageNumber: number) =>
    Promise.resolve({
      cleanup: vi.fn(),
      getViewport: ({ scale }: { scale: number }) => ({ height: 900 * scale, width: 600 * scale }),
      render: ({
        canvas,
        transform,
        viewport
      }: {
        canvas: HTMLCanvasElement
        transform?: unknown
        viewport: { width: number }
      }) => {
        renderCalls.push({
          canvasHeight: canvas.height,
          canvasWidth: canvas.width,
          pageNumber,
          transform,
          viewportWidth: viewport.width
        })

        return {
          cancel: renderTaskCancelMock,
          promise: pdfjsState.renderFailure ? Promise.reject(new Error(pdfjsState.renderFailure)) : Promise.resolve()
        }
      }
    })
  )
  const getDocumentMock = vi.fn((_source?: unknown) => ({
    destroy: vi.fn(() => Promise.resolve()),
    promise: pdfjsState.documentFailure
      ? Promise.reject(new Error(pdfjsState.documentFailure))
      : Promise.resolve({
          destroy: vi.fn(() => Promise.resolve()),
          getPage: getPageMock,
          numPages: 70
        })
  }))

  return { getDocumentMock, getPageMock, pdfjsState, renderCalls, renderTaskCancelMock, workerState }
})

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

vi.mock("pdfjs-dist", () => ({
  getDocument: (source: unknown) => getDocumentMock(source),
  GlobalWorkerOptions: workerState
}))

describe("EvidenceViewer", () => {
  beforeEach(() => {
    useQuery.mockReset()
    getDocumentMock.mockClear()
    getPageMock.mockClear()
    pdfjsState.documentFailure = null
    pdfjsState.renderFailure = null
    renderCalls.length = 0
    renderTaskCancelMock.mockClear()
    workerState.workerSrc = ""
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
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 })
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

  it("renders all PDF pages with pdfjs-dist so the viewer can scroll", async () => {
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
    const pdfViewer = screen.getByTestId("pdf-viewer")
    expect(pdfViewer).toHaveAttribute("data-file-url", "https://storage.example/manual.pdf")
    expect(pdfViewer).toHaveAttribute("data-page-number", "70")
    expect(pdfViewer).toHaveClass("h-full", "min-h-0", "overflow-y-auto")
    expect(pdfViewer).not.toHaveClass("min-h-100")
    expect(pdfViewer.parentElement).toHaveClass("min-h-0", "overflow-hidden")
    expect(pdfViewer.closest("section")).toHaveClass("h-[calc(100dvh-3rem)]", "overflow-hidden")
    expect(useQuery.mock.calls[0]?.[1]).toEqual({
      assetId: "documentAssets_1",
      citationLabel: "Engine manual"
    })
    await screen.findAllByTestId("pdf-page")
    await waitFor(() => expect(renderCalls).toHaveLength(70))
    expect(getDocumentMock).toHaveBeenCalledWith({ url: "https://storage.example/manual.pdf", wasmUrl: "/pdfjs/wasm/" })
    expect(getPageMock).toHaveBeenCalledTimes(70)
    expect(getPageMock.mock.calls.map(([pageNumber]) => pageNumber)).toEqual(Array.from({ length: 70 }, (_, index) => index + 1))
    expect(renderCalls[0]).toMatchObject({ canvasHeight: 1080, canvasWidth: 720, pageNumber: 1, viewportWidth: 720 })
    expect(scrollTargets[0]).toBe(screen.getAllByTestId("pdf-page")[69])
    expect(workerState.workerSrc).toContain("pdf.worker.min.mjs")
    expect(screen.queryByTitle("Engine manual")).not.toBeInTheDocument()
  })

  it("scrolls again after switching to another PDF with the same page count", async () => {
    useQuery.mockReturnValue({
      _id: "documentAssets_1",
      kind: "source_pdf",
      pageNumber: 10,
      url: "https://storage.example/manual-a.pdf"
    })

    const { rerender } = render(
      <EvidenceViewer
        asset={{
          assetId: "documentAssets_1" as never,
          label: "Engine manual A",
          pageNumber: 10
        }}
      />
    )

    await screen.findAllByTestId("pdf-page")
    await waitFor(() => expect(scrollTargets).toHaveLength(1))

    useQuery.mockReturnValue({
      _id: "documentAssets_2",
      kind: "source_pdf",
      pageNumber: 10,
      url: "https://storage.example/manual-b.pdf"
    })
    rerender(
      <EvidenceViewer
        asset={{
          assetId: "documentAssets_2" as never,
          label: "Engine manual B",
          pageNumber: 10
        }}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-file-url", "https://storage.example/manual-b.pdf")
    )
    await screen.findAllByTestId("pdf-page")

    await waitFor(() => expect(scrollTargets).toHaveLength(2))
    expect(scrollTargets[1]).toBe(screen.getAllByTestId("pdf-page")[9])
  })

  it("falls back to the browser PDF viewer when pdfjs-dist cannot load the document", async () => {
    pdfjsState.documentFailure = "Failed to fetch"
    useQuery.mockReturnValue({
      _id: "documentAssets_1",
      kind: "source_pdf",
      pageNumber: 70,
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

    const fallbackFrame = await screen.findByTitle("PDF preview")

    expect(fallbackFrame).toHaveAttribute("src", "https://storage.example/manual.pdf#page=70")
    expect(screen.queryByText("Unable to render PDF preview inline.")).not.toBeInTheDocument()
  })
})
