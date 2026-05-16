import type { SupportingAsset } from "@entities/knowledge/model/types"

import { useEffect, useRef, useState } from "react"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

type ReactPdfModule = typeof import("react-pdf")

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
  const [pdfModule, setPdfModule] = useState<ReactPdfModule | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const lastScrolledKeyRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPdfModule() {
      try {
        const module = await import("react-pdf")
        module.pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

        if (!cancelled) {
          setPdfModule(module)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Unable to load the PDF viewer.")
        }
      }
    }

    void loadPdfModule()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (pdfModule === null || pageCount === null || viewerWidth <= 0) {
      return
    }

    const scrollKey = `${fileUrl}:${pageNumber}`
    if (lastScrolledKeyRef.current === scrollKey) {
      return
    }

    const targetPage = pageRefs.current.get(pageNumber)
    if (!targetPage) {
      return
    }

    targetPage.scrollIntoView({ block: "start" })
    lastScrolledKeyRef.current = scrollKey
  }, [fileUrl, pageCount, pageNumber, pdfModule, viewerWidth])

  if (loadError) {
    return (
      <div className="flex min-h-[400px] items-center justify-center bg-[#FAFAFA] p-6">
        <div className="wire-border diagonal-bg max-w-sm bg-white p-6 text-center">
          <p className="bg-white p-2 font-mono text-[12px] text-[#000000]">Unable to render PDF preview inline.</p>
          <a
            className="wire-border mt-4 inline-flex bg-white px-4 py-2 font-mono text-[10px] tracking-widest text-[#000000] uppercase"
            href={fileUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open PDF
          </a>
        </div>
      </div>
    )
  }

  const showDocument = pdfModule !== null && viewerWidth > 0

  return (
    <div
      ref={ref}
      className="h-full min-h-[400px] w-full touch-pan-y overflow-y-auto overscroll-contain bg-white"
      data-file-url={fileUrl}
      data-page-number={pageNumber}
      data-testid="pdf-viewer"
    >
      {showDocument ? (
        <pdfModule.Document
          className="block min-h-[400px] bg-white"
          error={
            <div className="flex min-h-[400px] items-center justify-center bg-[#FAFAFA] p-6">
              <div className="wire-border diagonal-bg max-w-sm bg-white p-6 text-center">
                <p className="bg-white p-2 font-mono text-[12px] text-[#000000]">Unable to render PDF preview inline.</p>
                <a
                  className="wire-border mt-4 inline-flex bg-white px-4 py-2 font-mono text-[10px] tracking-widest text-[#000000] uppercase"
                  href={fileUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open PDF
                </a>
              </div>
            </div>
          }
          file={fileUrl}
          loading={<div className="crosshatch-bg wire-border h-[400px] animate-pulse bg-white" />}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages)
          }}
        >
          {pageCount === null ? null : (
            <div className="flex flex-col gap-4">
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
                    <pdfModule.Page
                      className="block"
                      loading={<div className="crosshatch-bg wire-border h-[400px] animate-pulse bg-white" />}
                      pageNumber={currentPageNumber}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      width={viewerWidth}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </pdfModule.Document>
      ) : (
        <div className="crosshatch-bg wire-border h-[400px] animate-pulse bg-white" />
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
      <section className="wire-border relative flex min-h-160 flex-1 items-center justify-center border-dashed bg-white p-10 text-center font-mono text-[11px] tracking-[0.2em] text-[#000000] uppercase">
        Awaiting...
      </section>
    )
  }

  if (viewerAsset === undefined) {
    return (
      <section className="wire-border relative flex h-full min-h-0 flex-1 flex-col bg-white">
        <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-4 md:p-6">
          <h3 className="text-[14px] font-medium tracking-wide text-[#000000] uppercase">Visual Output</h3>
          <span className="wire-border px-3 py-1 font-mono text-[10px] font-medium tracking-widest text-[#000000] uppercase">
            Loading...
          </span>
        </div>
        <div className="min-h-0 flex-1 p-4 md:p-6">
          <div className="crosshatch-bg wire-border h-full w-full animate-pulse" />
        </div>
      </section>
    )
  }

  if (!viewerAsset) {
    return (
      <section className="wire-border relative flex h-full min-h-0 flex-1 flex-col bg-white">
        <div className="wire-border-b flex shrink-0 items-center justify-between bg-[#FAFAFA] p-4 md:p-6">
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
    <section className="wire-border relative flex min-h-0 flex-1 flex-col bg-white">
      <div className="wire-border-b flex flex-col justify-between gap-4 bg-[#FAFAFA] p-4 md:flex-row md:items-center md:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="h-1.5 w-1.5 shrink-0 bg-[#000000]"></span>
          <h3 className="truncate text-[14px] font-medium tracking-wide text-[#000000] uppercase">{asset.label}</h3>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4 md:p-6">
        <PdfPageViewer fileUrl={viewerAsset.url} pageNumber={pageNumber} />
      </div>
    </section>
  )
}
