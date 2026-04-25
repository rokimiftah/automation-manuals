import { describe, expect, it, vi } from "vitest"

import { embedTexts, extractTextContent, generateGroundedAnswer, ocrPdfPage } from "./mistral"

describe("extractTextContent", () => {
  it("joins text content from structured message parts", () => {
    expect(
      extractTextContent([{ text: '{"answerSummary":"Install the module","answerSteps":[' }, { text: '"Check the chassis"]}' }])
    ).toBe('{"answerSummary":"Install the module","answerSteps":["Check the chassis"]}')
  })
})

describe("embedTexts", () => {
  it("returns embeddings from the provider response", async () => {
    const client = {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }]
        })
      }
    }

    await expect(embedTexts(["first chunk", "second chunk"], { client, model: "mistral-embed" })).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4]
    ])
    expect(client.embeddings.create).toHaveBeenCalledWith({
      inputs: ["first chunk", "second chunk"],
      model: "mistral-embed"
    })
  })

  it("splits large embedding requests into smaller batches", async () => {
    const client = {
      embeddings: {
        create: vi
          .fn()
          .mockResolvedValueOnce({
            data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }]
          })
          .mockResolvedValueOnce({
            data: [{ embedding: [0.5, 0.6] }]
          })
      }
    }

    await expect(
      embedTexts(["first chunk", "second chunk", "third chunk"], { batchSize: 2, client, model: "mistral-embed" })
    ).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6]
    ])
    expect(client.embeddings.create).toHaveBeenNthCalledWith(1, {
      inputs: ["first chunk", "second chunk"],
      model: "mistral-embed"
    })
    expect(client.embeddings.create).toHaveBeenNthCalledWith(2, {
      inputs: ["third chunk"],
      model: "mistral-embed"
    })
  })
})

describe("ocrPdfPage", () => {
  it("requests the document url with 0-based OCR page selection", async () => {
    const client = {
      ocr: {
        process: vi.fn().mockResolvedValue({
          pages: [{ markdown: "Connect the chassis cable." }]
        })
      }
    }

    await expect(ocrPdfPage("https://vendor.example/manual.pdf", 9, { client, model: "mistral-ocr-latest" })).resolves.toBe(
      "Connect the chassis cable."
    )
    expect(client.ocr.process).toHaveBeenCalledWith({
      document: {
        documentUrl: "https://vendor.example/manual.pdf",
        type: "document_url"
      },
      model: "mistral-ocr-latest",
      pages: [8],
      tableFormat: "markdown"
    })
  })
})

describe("generateGroundedAnswer", () => {
  it("parses json mode content from structured response parts", async () => {
    const client = {
      chat: {
        complete: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: [
                  { text: '{"answerSummary":"Install the module beside the controller.","answerSteps":[' },
                  { text: '"Verify the mounting rail"],"citationIds":["E1"]}' }
                ]
              }
            }
          ]
        })
      }
    }

    await expect(
      generateGroundedAnswer("Where should the module go?", "Install it next to the controller.", {
        client,
        model: "mistral-small-latest"
      })
    ).resolves.toEqual({
      answerSteps: ["Verify the mounting rail"],
      answerSummary: "Install the module beside the controller.",
      citationIds: ["E1"]
    })
    expect(client.chat.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            content:
              "Use only the provided context. If the context is insufficient, say so and return an empty answerSteps array and an empty citationIds array. Return strict JSON with keys answerSummary, answerSteps, and citationIds.",
            role: "system"
          },
          {
            content: "Question: Where should the module go?\n\nContext: Install it next to the controller.",
            role: "user"
          }
        ],
        model: "mistral-small-latest",
        responseFormat: {
          type: "json_object"
        }
      })
    )
  })
})
