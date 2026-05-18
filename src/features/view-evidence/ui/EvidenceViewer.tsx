import type { SupportingAsset } from "@entities/knowledge/model/types"

import { useEffect, useRef, useState } from "react"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

type PdfDocumentProxy = import("pdfjs-dist").PDFDocumentProxy
type PdfJsModule = typeof import("pdfjs-dist")
type PdfPageProxy = import("pdfjs-dist").PDFPageProxy
type RenderTask = import("pdfjs-dist").RenderTask

type PdfDocumentState = {
  fileUrl: string
  pdfDocument: PdfDocumentProxy
}

function buildPdfJsWasmUrl() {
  const baseUrl = import.meta.env.BASE_URL
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}pdfjs/wasm/`
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getSafePageNumber(pageNumber: number, pageCount?: number) {
  const normalizedPageNumber = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1
  return pageCount === undefined ? normalizedPageNumber : Math.min(normalizedPageNumber, pageCount)
}

function buildPdfPageUrl(fileUrl: string, pageNumber: number) {
  const safePageNumber = getSafePageNumber(pageNumber)

  try {
    const url = new URL(fileUrl)
    url.hash = `page=${safePageNumber}`
    return url.toString()
  } catch {
    return `${fileUrl.split("#")[0]}#page=${safePageNumber}`
  }
}

function BrowserPdfFallback({ fileUrl, pageNumber }: { fileUrl: string; pageNumber: number }) {
  const pageUrl = buildPdfPageUrl(fileUrl, pageNumber)

  return (
    <div className="flex h-full min-h-100 flex-col gap-3 bg-white">
      <iframe className="h-full min-h-100 w-full flex-1 bg-white" src={pageUrl} title="PDF preview" />
      <a
        className="wire-border inline-flex self-start bg-white px-4 py-2 font-mono text-[10px] tracking-widest text-[#000000] uppercase"
        href={pageUrl}
        rel="noreferrer"
        target="_blank"
      >
        Open PDF
      </a>
    </div>
  )
}

function getCanvasOutputScale() {
  if (typeof window === "undefined") {
    return 1
  }

  const devicePixelRatio = window.devicePixelRatio
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
}

function PdfPageCanvas({
  onRenderError,
  pageNumber,
  pdfDocument,
  width
}: {
  onRenderError: (error: unknown) => void
  pageNumber: number
  pdfDocument: PdfDocumentProxy
  width: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renderStatus, setRenderStatus] = useState<"loading" | "ready">("loading")

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) {
      return
    }
    const targetCanvas = canvas

    let cancelled = false
    let page: PdfPageProxy | null = null
    let renderTask: RenderTask | null = null

    async function renderPage() {
      setRenderStatus("loading")

      try {
        page = await pdfDocument.getPage(pageNumber)
        if (cancelled) {
          page.cleanup()
          page = null
          return
        }

        const initialViewport = page.getViewport({ scale: 1 })
        if (initialViewport.width <= 0) {
          throw new Error("Invalid PDF page width.")
        }

        const viewport = page.getViewport({ scale: width / initialViewport.width })
        const canvasContext = targetCanvas.getContext("2d")

        if (!canvasContext) {
          throw new Error("Unable to initialize PDF canvas.")
        }

        const outputScale = getCanvasOutputScale()
        targetCanvas.width = Math.floor(viewport.width * outputScale)
        targetCanvas.height = Math.floor(viewport.height * outputScale)
        targetCanvas.style.height = `${Math.floor(viewport.height)}px`
        targetCanvas.style.width = `${Math.floor(viewport.width)}px`

        renderTask = page.render({
          canvas: targetCanvas,
          canvasContext,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport
        })

        await renderTask.promise
        renderTask = null
        if (!cancelled) {
          setRenderStatus("ready")
        }
      } catch (error) {
        if (!cancelled) {
          onRenderError(error)
        }
      } finally {
        if (page) {
          page.cleanup()
          page = null
        }
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      page?.cleanup()
    }
  }, [onRenderError, pageNumber, pdfDocument, width])

  return (
    <div className="relative min-h-100 bg-white">
      {renderStatus === "loading" ? <div className="crosshatch-bg wire-border h-100 animate-pulse bg-white" /> : null}
      <canvas
        aria-label={`PDF page ${pageNumber}`}
        className={renderStatus === "ready" ? "block max-w-full bg-white" : "hidden"}
        ref={canvasRef}
        role="img"
      />
    </div>
  )
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const updateWidth = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width)
      setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  return { ref, width }
}

function PdfPageViewer({ fileUrl, pageNumber }: { fileUrl: string; pageNumber: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const viewerWidth = width ?? 0
  const [pdfModule, setPdfModule] = useState<PdfJsModule | null>(null)
  const [pdfDocumentState, setPdfDocumentState] = useState<PdfDocumentState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const lastScrolledKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!fileUrl) {
      return
    }

    setPageCount(null)
    setPdfDocumentState(null)
    setLoadError(null)
    pageRefs.current.clear()
  }, [fileUrl])

  useEffect(() => {
    let cancelled = false

    async function loadPdfModule() {
      try {
        const module = await import("pdfjs-dist")
        module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

        if (!cancelled) {
          setPdfModule(module)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(getErrorMessage(error, "Unable to load the PDF viewer."))
        }
      }
    }

    void loadPdfModule()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (pdfModule === null || !fileUrl) {
      return
    }

    let cancelled = false
    let pdfDocument: PdfDocumentProxy | null = null
    const loadingTask = pdfModule.getDocument({ url: fileUrl, wasmUrl: buildPdfJsWasmUrl() })

    setPageCount(null)
    setPdfDocumentState(null)
    setLoadError(null)
    pageRefs.current.clear()

    async function loadPdfDocument() {
      try {
        pdfDocument = await loadingTask.promise
        if (!cancelled) {
          setPdfDocumentState({ fileUrl, pdfDocument })
          setPageCount(pdfDocument.numPages)
        } else {
          void pdfDocument.destroy()
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(getErrorMessage(error, "Unable to load the PDF document."))
        }
      }
    }

    void loadPdfDocument()

    return () => {
      cancelled = true
      if (pdfDocument) {
        void pdfDocument.destroy()
      } else {
        void loadingTask.destroy()
      }
    }
  }, [fileUrl, pdfModule])

  useEffect(() => {
    if (pdfDocumentState === null || pageCount === null || viewerWidth <= 0) {
      return
    }

    const safePageNumber = getSafePageNumber(pageNumber, pageCount)

    const scrollKey = `${fileUrl}:${safePageNumber}`
    if (lastScrolledKeyRef.current === scrollKey) {
      return
    }

    const targetPage = pageRefs.current.get(safePageNumber)
    const viewerElement = ref.current
    if (!targetPage || !viewerElement) {
      return
    }

    viewerElement.scrollTo({ top: targetPage.offsetTop })
    lastScrolledKeyRef.current = scrollKey
  }, [fileUrl, pageCount, pageNumber, pdfDocumentState, viewerWidth, ref.current])

  if (loadError) {
    return <BrowserPdfFallback fileUrl={fileUrl} pageNumber={pageNumber} />
  }

  const showDocument = pdfDocumentState !== null && pdfDocumentState.fileUrl === fileUrl && pageCount !== null && viewerWidth > 0

  return (
    <div
      ref={ref}
      className="relative h-full min-h-0 w-full touch-pan-y overflow-y-auto overscroll-contain bg-white"
      data-file-url={fileUrl}
      data-page-number={pageNumber}
      data-testid="pdf-viewer"
    >
      {showDocument ? (
        <div className="flex flex-col gap-6">
          {Array.from({ length: pageCount }, (_, index) => {
            const currentPageNumber = index + 1

            return (
              <div
                key={currentPageNumber}
                className="wire-border bg-white"
                data-page-number={currentPageNumber}
                data-testid="pdf-page"
                ref={(node) => {
                  if (node) {
                    pageRefs.current.set(currentPageNumber, node)
                  } else {
                    pageRefs.current.delete(currentPageNumber)
                  }
                }}
              >
                <PdfPageCanvas
                  onRenderError={(error) => {
                    setLoadError(getErrorMessage(error, "Unable to render the PDF page."))
                  }}
                  pageNumber={currentPageNumber}
                  pdfDocument={pdfDocumentState.pdfDocument}
                  width={viewerWidth}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="crosshatch-bg wire-border h-100 animate-pulse bg-white" />
      )}
    </div>
  )
}

export default function EvidenceViewer({ asset }: { asset: SupportingAsset | null }) {
  const viewerAsset = useQuery(
    api.assets.resolveViewerAsset,
    asset ? { assetId: asset.assetId, citationLabel: asset.label } : "skip"
  )

  if (!asset) {
    return (
      <section className="wire-border relative flex min-h-160 flex-1 flex-col items-center justify-center border-dashed bg-white p-10 text-center">
        <div className="space-y-4">
          <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-[#E5E5E5]" />
          <p className="font-mono text-[11px] tracking-[0.2em] text-[#555555] uppercase">Awaiting...</p>
        </div>
      </section>
    )
  }

  if (viewerAsset === undefined) {
    return (
      <section className="wire-border relative flex h-full min-h-0 flex-1 flex-col bg-white">
        <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-6">
          <h3 className="text-[14px] font-medium tracking-wide text-[#000000] uppercase">Visual Output</h3>
          <span className="wire-border px-3 py-1 font-mono text-[10px] font-medium tracking-widest text-[#000000] uppercase">
            Loading...
          </span>
        </div>
        <div className="min-h-0 flex-1 p-6">
          <div className="crosshatch-bg wire-border h-full w-full animate-pulse" />
        </div>
      </section>
    )
  }

  if (!viewerAsset) {
    return (
      <section className="wire-border relative flex h-full min-h-0 flex-1 flex-col bg-white">
        <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-6">
          <h3 className="text-[14px] font-medium tracking-wide text-[#000000] uppercase">Visual Output</h3>
          <span className="wire-border bg-[#000000] px-3 py-1 font-mono text-[10px] font-medium tracking-widest text-white uppercase">
            Error 404
          </span>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#FAFAFA] p-6 md:p-8">
          <div className="wire-border diagonal-bg max-w-sm bg-white p-8 text-center">
            <span className="wire-border mb-2 inline-block bg-white px-4 py-2 text-[14px] font-medium tracking-widest uppercase">
              File Missing
            </span>
            <p className="bg-white p-2 font-mono text-[12px] text-[#000000]">Reference removed from storage.</p>
          </div>
        </div>
      </section>
    )
  }

  const pageNumber = asset.pageNumber

  return (
    <section className="wire-border relative flex h-[min(32rem,calc(100dvh-3rem))] min-h-0 flex-col overflow-hidden bg-white lg:h-auto lg:flex-1 lg:overflow-visible">
      <div className="wire-border-b flex flex-col justify-between gap-6 bg-[#FAFAFA] p-6 md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-6">
          <span className="h-1.5 w-1.5 shrink-0 bg-[#000000]"></span>
          <h3 className="truncate text-[14px] font-medium tracking-wide text-[#000000] uppercase">{asset.label}</h3>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-6">
        <PdfPageViewer fileUrl={viewerAsset.url} pageNumber={pageNumber} />
      </div>
    </section>
  )
}
