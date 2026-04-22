import { describe, expect, it, vi } from "vitest"

import { extractParsedPages, parseDocumentMarkdown } from "./llamaCloud"

describe("extractParsedPages", () => {
  it("maps successful markdown pages and ignores failed pages", () => {
    expect(
      extractParsedPages({
        job: { id: "job-1", status: "COMPLETED" },
        markdown: {
          pages: [
            {
              markdown: "## LED status\n\n| LED | Meaning |\n| --- | --- |\n| OK red | Hardware fault |",
              page_number: 45,
              printed_page_number: "45",
              success: true
            },
            {
              markdown: "",
              page_number: 46,
              success: false
            }
          ]
        }
      })
    ).toEqual([
      {
        markdown: "## LED status\n\n| LED | Meaning |\n| --- | --- |\n| OK red | Hardware fault |",
        pageNumber: 45,
        printedPageNumber: "45"
      }
    ])
  })
})

describe("parseDocumentMarkdown", () => {
  it("creates a parse job and polls until markdown is ready", async () => {
    const client = {
      parsing: {
        create: vi.fn().mockResolvedValue({ id: "job-1" }),
        get: vi
          .fn()
          .mockResolvedValueOnce({
            job: { id: "job-1", status: "RUNNING" },
            markdown: null
          })
          .mockResolvedValueOnce({
            job: { id: "job-1", status: "COMPLETED" },
            markdown: {
              pages: [
                {
                  markdown: "## Install controller\n\nConnect the chassis cable.",
                  page_number: 1,
                  printed_page_number: "A-1",
                  success: true
                }
              ]
            }
          })
      }
    }

    const pages = await parseDocumentMarkdown("https://vendor.example/manual.pdf", {
      client,
      maxAttempts: 3,
      sleep: async () => {}
    })

    expect(client.parsing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        output_options: expect.objectContaining({
          extract_printed_page_number: true,
          markdown: expect.objectContaining({
            tables: expect.objectContaining({
              merge_continued_tables: true,
              output_tables_as_markdown: true
            })
          })
        }),
        source_url: "https://vendor.example/manual.pdf",
        tier: "agentic",
        version: "latest"
      })
    )
    expect(client.parsing.get).toHaveBeenCalledTimes(2)
    expect(client.parsing.get).toHaveBeenNthCalledWith(1, "job-1", {
      expand: ["markdown"]
    })
    expect(client.parsing.get).toHaveBeenNthCalledWith(2, "job-1", {
      expand: ["markdown"]
    })
    expect(pages).toEqual([
      {
        markdown: "## Install controller\n\nConnect the chassis cable.",
        pageNumber: 1,
        printedPageNumber: "A-1"
      }
    ])
  })
})
