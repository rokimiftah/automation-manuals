import { beforeEach, describe, expect, it, vi } from "vitest"

import { deleteDocument } from "./documents"

const { requireAdminWriteSession } = vi.hoisted(() => ({
  requireAdminWriteSession: vi.fn()
}))

vi.mock("./lib/adminSession", async () => {
  const actual = await vi.importActual<typeof import("./lib/adminSession")>("./lib/adminSession")
  return {
    ...actual,
    requireAdminWriteSession
  }
})

const deleteDocumentHandler = deleteDocument as typeof deleteDocument & {
  _handler: (ctx: unknown, args: { documentId: never; sessionToken: string }) => Promise<null>
}

describe("deleteDocument", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("deletes the document, its artifacts, and related chat history", async () => {
    const document = {
      _id: "documents_1" as never,
      productId: "products_1" as never,
      sourceAssetId: "documentAssets_1" as never,
      status: "ready"
    }

    const documentAssets = [
      {
        _id: "documentAssets_1" as never,
        documentId: "documents_1" as never,
        storageId: "_storage_1" as never
      }
    ]

    const documentPages = [{ _id: "documentPages_1" as never, documentId: "documents_1" as never }]
    const chunks = [{ _id: "chunks_1" as never, documentId: "documents_1" as never }]
    const chunkEmbeddings = [{ _id: "chunkEmbeddings_1" as never, documentId: "documents_1" as never }]
    const ingestionJobs = [{ _id: "ingestionJobs_1" as never, documentId: "documents_1" as never }]
    const answerEvidence = [
      {
        _id: "answerEvidence_1" as never,
        assetId: "documentAssets_1" as never,
        chunkId: "chunks_1" as never,
        messageId: "chatMessages_2" as never,
        pageNumber: 12,
        score: 0.91
      }
    ]
    const chatMessages = [
      {
        _id: "chatMessages_1" as never,
        content: "Where is Rockwell mentioned?",
        role: "user",
        sessionId: "chatSessions_1" as never
      },
      {
        _id: "chatMessages_2" as never,
        content: "Rockwell is on page 12.",
        role: "assistant",
        sessionId: "chatSessions_1" as never
      }
    ]

    const query = vi.fn((table: string) => {
      const collections: Record<string, unknown[]> = {
        answerEvidence,
        chatMessages,
        chunkEmbeddings,
        chunks,
        documentAssets,
        documentPages,
        ingestionJobs
      }

      return {
        collect: vi.fn().mockResolvedValue(collections[table] ?? [])
      }
    })
    const get = vi.fn().mockResolvedValue(document)
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockResolvedValue("auditEvents_1")
    const storageDelete = vi.fn().mockResolvedValue(undefined)

    await deleteDocumentHandler._handler(
      {
        db: {
          delete: deleteRow,
          get,
          insert,
          query
        },
        storage: {
          delete: storageDelete
        }
      } as never,
      {
        documentId: "documents_1" as never,
        sessionToken: "token-123"
      }
    )

    expect(storageDelete).toHaveBeenCalledWith("_storage_1")
    expect(deleteRow).toHaveBeenCalledWith("answerEvidence", "answerEvidence_1")
    expect(deleteRow).toHaveBeenCalledWith("chatMessages", "chatMessages_1")
    expect(deleteRow).toHaveBeenCalledWith("chatMessages", "chatMessages_2")
    expect(deleteRow).toHaveBeenCalledWith("chatSessions", "chatSessions_1")
    expect(deleteRow).toHaveBeenCalledWith("chunkEmbeddings", "chunkEmbeddings_1")
    expect(deleteRow).toHaveBeenCalledWith("chunks", "chunks_1")
    expect(deleteRow).toHaveBeenCalledWith("documentAssets", "documentAssets_1")
    expect(deleteRow).toHaveBeenCalledWith("documentPages", "documentPages_1")
    expect(deleteRow).toHaveBeenCalledWith("ingestionJobs", "ingestionJobs_1")
    expect(deleteRow).toHaveBeenCalledWith("documents", "documents_1")
    expect(insert).toHaveBeenCalledWith(
      "auditEvents",
      expect.objectContaining({
        action: "document.delete",
        targetId: "documents_1",
        targetTable: "documents"
      })
    )
  })
})
