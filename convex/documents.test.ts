import { beforeEach, describe, expect, it, vi } from "vitest"

import { setActive } from "./documents"

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

const setActiveHandler = setActive as typeof setActive & {
  _handler: (ctx: unknown, args: { documentId: unknown; isActive: boolean; sessionToken: string }) => Promise<null>
}

describe("setActive", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("deactivates active sibling versions when activating a ready document", async () => {
    const targetDocument = {
      _id: "documents_2" as never,
      isActive: false,
      productId: "products_1" as never,
      status: "ready"
    }
    const activeSibling = {
      _id: "documents_1" as never,
      isActive: true,
      productId: "products_1" as never,
      status: "ready"
    }
    const patch = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockResolvedValue("auditEvents_1")

    await setActiveHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue(targetDocument),
          insert,
          patch,
          query: vi.fn().mockReturnValue({
            withIndex: vi.fn().mockReturnValue({
              collect: vi.fn().mockResolvedValue([activeSibling])
            })
          })
        }
      } as never,
      {
        documentId: "documents_2" as never,
        isActive: true,
        sessionToken: "token-123"
      }
    )

    expect(patch).toHaveBeenNthCalledWith(1, "documents", "documents_1", expect.objectContaining({ isActive: false }))
    expect(patch).toHaveBeenNthCalledWith(2, "documents", "documents_2", expect.objectContaining({ isActive: true }))
    expect(insert).toHaveBeenCalledWith(
      "auditEvents",
      expect.objectContaining({
        action: "document.set_active",
        targetId: "documents_2",
        targetTable: "documents"
      })
    )
  })

  it("rejects activation when the document is not ready", async () => {
    await expect(
      setActiveHandler._handler(
        {
          db: {
            get: vi.fn().mockResolvedValue({
              _id: "documents_2" as never,
              isActive: false,
              productId: "products_1" as never,
              status: "draft"
            })
          }
        } as never,
        {
          documentId: "documents_2" as never,
          isActive: true,
          sessionToken: "token-123"
        }
      )
    ).rejects.toThrow("Only ready documents can be activated")
  })
})
