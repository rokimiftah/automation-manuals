import { beforeEach, describe, expect, it, vi } from "vitest"

import { create, generateSourceUploadUrl } from "./documents"

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

const createHandler = create as typeof create & {
  _handler: (
    ctx: unknown,
    args: {
      language: string
      productName: string
      sessionToken: string
      sourceStorageId: unknown
      title: string
      vendorName: string
      version: string
    }
  ) => Promise<unknown>
}

const generateSourceUploadUrlHandler = generateSourceUploadUrl as typeof generateSourceUploadUrl & {
  _handler: (ctx: unknown, args: { sessionToken: string }) => Promise<string>
}

describe("create", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("stores the uploaded source file when creating a document", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("vendors_1")
      .mockResolvedValueOnce("products_1")
      .mockResolvedValueOnce("documents_1")
      .mockResolvedValueOnce("auditEvents_1")
    const query = vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        unique: vi.fn().mockResolvedValue(null)
      })
    })
    const storageGetUrl = vi.fn().mockResolvedValue("https://convex.example/api/storage/source")

    await createHandler._handler(
      {
        db: {
          insert,
          query
        },
        storage: {
          getUrl: storageGetUrl
        }
      } as never,
      {
        language: "English",
        productName: "GuardLogix 5570 Controllers",
        sessionToken: "token-123",
        sourceStorageId: "_storage_1" as never,
        title: "GuardLogix 5570 Controllers User Manual",
        vendorName: "Rockwell Automation",
        version: "20.01"
      }
    )

    expect(storageGetUrl).toHaveBeenCalledWith("_storage_1")
    expect(insert).toHaveBeenCalledWith(
      "documents",
      expect.objectContaining({
        sourceUrl: "https://convex.example/api/storage/source"
      })
    )
  })
})

describe("generateSourceUploadUrl", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("generates an upload url for the admin upload flow", async () => {
    const generateUploadUrl = vi.fn().mockResolvedValue("https://upload.example/source")

    const result = await generateSourceUploadUrlHandler._handler(
      {
        storage: {
          generateUploadUrl
        }
      } as never,
      {
        sessionToken: "token-123"
      }
    )

    expect(result).toBe("https://upload.example/source")
    expect(generateUploadUrl).toHaveBeenCalledTimes(1)
  })
})
