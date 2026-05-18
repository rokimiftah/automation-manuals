import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EvidenceViewer from "./EvidenceViewer"

// @vitest-environment jsdom

const useQuery = vi.fn()
let scrollTargets: HTMLElement[] = []
let scrollIntoViewDescriptor: PropertyDescriptor | undefined
let scrollToCalls: Array<{ top?: number }> = []
let scrollToDescriptor: PropertyDescriptor | undefined
let offsetTopDescriptor: PropertyDescriptor | undefined

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
    scrollToCalls = []
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
    scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo")
    offsetTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop")
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement) {
        scrollTargets.push(this)
      }
    })
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value(options?: ScrollToOptions) {
        scrollToCalls.push({ top: options?.top })
      }
    })
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.pageNumber ?? 0) * 120
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
    if (scrollToDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
    }
    if (offsetTopDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "offsetTop", offsetTopDescriptor)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "offsetTop")
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
    expect(pdfViewer.closest("section")).toHaveClass("h-[min(32rem,calc(100dvh-3rem))]", "overflow-hidden", "lg:flex-1")
    expect(pdfViewer.closest("section")).not.toHaveClass("h-[calc(100dvh-3rem)]", "flex-1")
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
    expect(scrollTargets).toHaveLength(0)
    expect(scrollToCalls[0]).toEqual({ top: 8400 })
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
    await waitFor(() => expect(scrollToCalls).toHaveLength(1))

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

    await waitFor(() => expect(scrollToCalls).toHaveLength(2))
    expect(scrollTargets).toHaveLength(0)
    expect(scrollToCalls[1]).toEqual({ top: 1200 })
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
