import { describe, expect, it, vi } from "vitest"

import { canManageDocuments, computeViewerAccess } from "./roles"
import { getViewer } from "./viewer"

describe("computeViewerAccess", () => {
  it("returns admin access for an admin email", () => {
    expect(
      computeViewerAccess("lead@example.com", {
        adminEmails: ["lead@example.com"],
        allowedDomains: [],
        allowedEmails: []
      })
    ).toEqual({
      canManageDocuments: true,
      isAllowed: true,
      role: "admin"
    })
  })

  it("returns an engineer role without access when the email is not allowed", () => {
    expect(
      computeViewerAccess("outsider@example.com", {
        adminEmails: [],
        allowedDomains: [],
        allowedEmails: ["engineer@example.com"]
      })
    ).toEqual({
      canManageDocuments: false,
      isAllowed: false,
      role: "engineer"
    })
  })

  it("allows engineers through an allowed domain", () => {
    expect(
      computeViewerAccess("tech@automation-manuals.internal", {
        adminEmails: [],
        allowedDomains: ["automation-manuals.internal"],
        allowedEmails: []
      })
    ).toEqual({
      canManageDocuments: false,
      isAllowed: true,
      role: "engineer"
    })
  })
})

describe("canManageDocuments", () => {
  it("returns false for engineers", () => {
    expect(canManageDocuments("engineer")).toBe(false)
  })
})

describe("getViewer", () => {
  it("supports action contexts through runQuery", async () => {
    const viewer = {
      canManageDocuments: true,
      email: "lead@example.com",
      isAllowed: true,
      name: "Lead",
      role: "admin",
      userId: "users_123"
    }

    const runQuery = vi.fn(async () => viewer)

    await expect(
      getViewer({
        auth: {
          getUserIdentity: async () => ({ subject: "users_123" })
        },
        runQuery
      } as never)
    ).resolves.toEqual(viewer)

    expect(runQuery).toHaveBeenCalledTimes(1)
  })
})
