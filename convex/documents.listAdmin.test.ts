import { describe, expect, it, vi } from "vitest"

import { listAdmin } from "./documents"

const { requireAdminQuerySession } = vi.hoisted(() => ({
  requireAdminQuerySession: vi.fn()
}))

vi.mock("./lib/adminSession", async () => {
  const actual = await vi.importActual<typeof import("./lib/adminSession")>("./lib/adminSession")
  return {
    ...actual,
    requireAdminQuerySession
  }
})

const listAdminHandler = listAdmin as typeof listAdmin & {
  _handler: (
    ctx: unknown,
    args: { sessionToken: string }
  ) => Promise<
    Array<{
      _id: never
      productSlug: string
      status: string
      title: string
      vendorSlug: string
      version: string
    }>
  >
}

describe("listAdmin", () => {
  it("omits the legacy activation flag from document listings", async () => {
    requireAdminQuerySession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })

    const documents = [
      {
        _id: "documents_1" as never,
        productSlug: "guardlogix-5570-controllers",
        status: "ready",
        title: "GuardLogix 5570 Controllers User Manual",
        vendorSlug: "rockwell-automation",
        version: "20.01"
      }
    ]
    const query = vi.fn().mockReturnValue({ collect: vi.fn().mockResolvedValue(documents) })

    const result = await listAdminHandler._handler(
      {
        db: { query }
      } as never,
      { sessionToken: "token-123" }
    )

    expect(result).toEqual([
      {
        _id: "documents_1",
        productSlug: "guardlogix-5570-controllers",
        status: "ready",
        title: "GuardLogix 5570 Controllers User Manual",
        vendorSlug: "rockwell-automation",
        version: "20.01"
      }
    ])
  })
})
