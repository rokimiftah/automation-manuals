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

function makeDeleteQuery(collections: Record<string, Array<Record<string, unknown>>>) {
  return vi.fn((table: string) => {
    return {
      collect: vi.fn(async () => collections[table] ?? []),
      withIndex: vi.fn((indexName: string, rangeBuilderFn: (builder: { eq: (field: string, value: string) => void }) => void) => {
        const calls: Array<[string, string]> = []
        const builder = {
          eq: vi.fn((field: string, value: string) => {
            calls.push([field, value])
            return builder
          })
        }

        rangeBuilderFn(builder)

        const rows = (collections[table] ?? []).filter((row) => {
          if (
            (table === "documentAssets" || table === "documentPages" || table === "chunks" || table === "chunkEmbeddings") &&
            indexName === "by_document_and_current"
          ) {
            return calls.every(([field, value]) => row[field] === value)
          }

          if (table === "ingestionJobs" && indexName === "by_document") {
            return row.documentId === calls.find(([field]) => field === "documentId")?.[1]
          }

          if (table === "answerEvidence" && indexName === "by_document") {
            return row.documentId === calls.find(([field]) => field === "documentId")?.[1]
          }

          if (table === "answerEvidence" && indexName === "by_message") {
            return row.messageId === calls.find(([field]) => field === "messageId")?.[1]
          }

          if (table === "chatMessages" && indexName === "by_session") {
            return row.sessionId === calls.find(([field]) => field === "sessionId")?.[1]
          }

          return true
        })

        return {
          collect: vi.fn(async () => rows)
        }
      })
    }
  })
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
        isCurrent: true,
        storageId: "_storage_1" as never
      }
    ]

    const documentPages = [{ _id: "documentPages_1" as never, documentId: "documents_1" as never, isCurrent: true }]
    const chunks = [{ _id: "chunks_1" as never, documentId: "documents_1" as never, isCurrent: true }]
    const chunkEmbeddings = [{ _id: "chunkEmbeddings_1" as never, documentId: "documents_1" as never, isCurrent: true }]
    const ingestionJobs = [{ _id: "ingestionJobs_1" as never, documentId: "documents_1" as never }]
    const answerEvidence = [
      {
        _id: "answerEvidence_1" as never,
        documentId: "documents_1" as never,
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

    const query = makeDeleteQuery({
      answerEvidence,
      chatMessages,
      chunkEmbeddings,
      chunks,
      documentAssets,
      documentPages,
      ingestionJobs
    })
    const get = vi.fn(async (...args: Array<string>) => {
      const id = args.length === 2 ? args[1] : args[0]

      if (id === "documents_1") {
        return document
      }

      if (id === "chatMessages_1") {
        return chatMessages[0]
      }

      if (id === "chatMessages_2") {
        return chatMessages[1]
      }

      return null
    })
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

  it("preserves mixed chat history that also references other documents", async () => {
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
        isCurrent: true,
        storageId: "_storage_1" as never
      }
    ]

    const documentPages = [{ _id: "documentPages_1" as never, documentId: "documents_1" as never, isCurrent: true }]
    const chunks = [{ _id: "chunks_1" as never, documentId: "documents_1" as never, isCurrent: true }]
    const chunkEmbeddings = [{ _id: "chunkEmbeddings_1" as never, documentId: "documents_1" as never, isCurrent: true }]
    const ingestionJobs = [{ _id: "ingestionJobs_1" as never, documentId: "documents_1" as never }]
    const answerEvidence = [
      {
        _id: "answerEvidence_1" as never,
        documentId: "documents_1" as never,
        assetId: "documentAssets_1" as never,
        chunkId: "chunks_1" as never,
        messageId: "chatMessages_2" as never,
        pageNumber: 12,
        score: 0.91
      },
      {
        _id: "answerEvidence_2" as never,
        documentId: "documents_2" as never,
        assetId: "documentAssets_2" as never,
        chunkId: "chunks_2" as never,
        messageId: "chatMessages_2" as never,
        pageNumber: 18,
        score: 0.83
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
        content: "Rockwell is on page 12 and also in another document.",
        role: "assistant",
        sessionId: "chatSessions_1" as never
      }
    ]

    const query = makeDeleteQuery({
      answerEvidence,
      chatMessages,
      chunkEmbeddings,
      chunks,
      documentAssets,
      documentPages,
      ingestionJobs
    })
    const get = vi.fn(async (...args: Array<string>) => {
      const id = args.length === 2 ? args[1] : args[0]

      if (id === "documents_1") {
        return document
      }

      if (id === "chatMessages_1") {
        return chatMessages[0]
      }

      if (id === "chatMessages_2") {
        return chatMessages[1]
      }

      return null
    })
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

    expect(deleteRow).toHaveBeenCalledWith("answerEvidence", "answerEvidence_1")
    expect(deleteRow).not.toHaveBeenCalledWith("chatMessages", "chatMessages_2")
    expect(deleteRow).not.toHaveBeenCalledWith("chatSessions", "chatSessions_1")
  })

  it("deletes historical artifacts and deduplicates storage cleanup", async () => {
    const document = {
      _id: "documents_1" as never,
      productId: "products_1" as never,
      sourceAssetId: "documentAssets_2" as never,
      status: "ready",
      title: "GuardLogix 5570 Controllers User Manual",
      version: "20.01"
    }

    const documentAssets = [
      {
        _id: "documentAssets_1" as never,
        documentId: "documents_1" as never,
        isCurrent: false,
        storageId: "_storage_shared" as never
      },
      {
        _id: "documentAssets_2" as never,
        documentId: "documents_1" as never,
        isCurrent: true,
        storageId: "_storage_shared" as never
      },
      {
        _id: "documentAssets_3" as never,
        documentId: "documents_1" as never,
        isCurrent: false,
        storageId: "_storage_old" as never
      }
    ]

    const documentPages = [
      { _id: "documentPages_1" as never, documentId: "documents_1" as never, isCurrent: false },
      { _id: "documentPages_2" as never, documentId: "documents_1" as never, isCurrent: true }
    ]
    const chunks = [
      { _id: "chunks_1" as never, documentId: "documents_1" as never, isCurrent: false },
      { _id: "chunks_2" as never, documentId: "documents_1" as never, isCurrent: true }
    ]
    const chunkEmbeddings = [
      { _id: "chunkEmbeddings_1" as never, documentId: "documents_1" as never, isCurrent: false },
      { _id: "chunkEmbeddings_2" as never, documentId: "documents_1" as never, isCurrent: true }
    ]
    const ingestionJobs = [{ _id: "ingestionJobs_1" as never, documentId: "documents_1" as never }]

    const query = makeDeleteQuery({
      answerEvidence: [],
      chatMessages: [],
      chunkEmbeddings,
      chunks,
      documentAssets,
      documentPages,
      ingestionJobs
    })
    const deleteRow = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockResolvedValue("auditEvents_1")
    const storageDelete = vi.fn().mockResolvedValue(undefined)

    await deleteDocumentHandler._handler(
      {
        db: {
          delete: deleteRow,
          get: vi.fn().mockResolvedValue(document),
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

    expect(deleteRow).toHaveBeenCalledWith("documentAssets", "documentAssets_1")
    expect(deleteRow).toHaveBeenCalledWith("documentAssets", "documentAssets_2")
    expect(deleteRow).toHaveBeenCalledWith("documentAssets", "documentAssets_3")
    expect(deleteRow).toHaveBeenCalledWith("documentPages", "documentPages_1")
    expect(deleteRow).toHaveBeenCalledWith("documentPages", "documentPages_2")
    expect(deleteRow).toHaveBeenCalledWith("chunks", "chunks_1")
    expect(deleteRow).toHaveBeenCalledWith("chunks", "chunks_2")
    expect(deleteRow).toHaveBeenCalledWith("chunkEmbeddings", "chunkEmbeddings_1")
    expect(deleteRow).toHaveBeenCalledWith("chunkEmbeddings", "chunkEmbeddings_2")
    expect(storageDelete).toHaveBeenCalledTimes(2)
    expect(storageDelete).toHaveBeenCalledWith("_storage_shared")
    expect(storageDelete).toHaveBeenCalledWith("_storage_old")
  })
})
