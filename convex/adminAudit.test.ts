import { beforeEach, describe, expect, it, vi } from "vitest"

import { recordLoginAttempt } from "./adminAuth"
import { seedDefaults } from "./evaluations"
import { enqueue, retry } from "./ingestion"

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

vi.mock("./lib/evaluationSeed", () => ({
  defaultEvaluationCases: [
    {
      category: "retrieval",
      expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
      expectedPageNumbers: [12],
      expectedRefusal: false,
      question: "Where should the module go?",
      severity: "medium",
      slug: "guardlogix-module-placement"
    }
  ]
}))

const enqueueHandler = enqueue as typeof enqueue & {
  _handler: (
    ctx: unknown,
    args: {
      documentId: unknown
      sessionToken: string
      sourceFileName: string
      sourceMimeType: string
      sourceStorageId: unknown
    }
  ) => Promise<unknown>
}

const retryHandler = retry as typeof retry & {
  _handler: (ctx: unknown, args: { jobId: unknown; sessionToken: string }) => Promise<unknown>
}

const recordLoginAttemptHandler = recordLoginAttempt as typeof recordLoginAttempt & {
  _handler: (ctx: unknown, args: { successful: boolean; username: string }) => Promise<null>
}

const seedDefaultsHandler = seedDefaults as typeof seedDefaults & {
  _handler: (ctx: unknown, args: { sessionToken: string }) => Promise<number>
}

describe("admin audit coverage", () => {
  beforeEach(() => {
    requireAdminWriteSession.mockReset()
    requireAdminWriteSession.mockResolvedValue({
      _id: "adminSessions_1",
      username: "admin"
    })
  })

  it("writes an audit event when an ingestion job is enqueued", async () => {
    const insert = vi.fn().mockResolvedValueOnce("ingestionJobs_1").mockResolvedValueOnce("auditEvents_1")
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")

    await enqueueHandler._handler(
      {
        db: { insert },
        scheduler: { runAfter }
      } as never,
      {
        documentId: "documents_1" as never,
        sessionToken: "token-123",
        sourceFileName: "manual.pdf",
        sourceMimeType: "application/pdf",
        sourceStorageId: "_storage_1" as never
      }
    )

    expect(insert).toHaveBeenNthCalledWith(
      1,
      "ingestionJobs",
      expect.objectContaining({
        sourceFileName: "manual.pdf",
        sourceMimeType: "application/pdf",
        sourceStorageId: "_storage_1"
      })
    )
    expect(insert).toHaveBeenCalledWith(
      "auditEvents",
      expect.objectContaining({
        action: "ingestion.enqueue",
        actorLabel: "admin",
        targetId: "ingestionJobs_1",
        targetTable: "ingestionJobs"
      })
    )
  })

  it("writes an audit event when a failed ingestion job is retried", async () => {
    const existingJob = {
      _creationTime: 1,
      _id: "ingestionJobs_1" as never,
      createdAt: 1,
      documentId: "documents_1" as never,
      status: "failed" as const
    }
    const insert = vi.fn().mockResolvedValueOnce("ingestionJobs_2").mockResolvedValueOnce("auditEvents_1")
    const runAfter = vi.fn().mockResolvedValue("_scheduled_functions_1")

    await retryHandler._handler(
      {
        db: {
          get: vi.fn().mockResolvedValue(existingJob),
          insert,
          query: vi.fn().mockReturnValue({
            withIndex: vi.fn().mockReturnValue({
              collect: vi.fn().mockResolvedValue([existingJob])
            })
          })
        },
        scheduler: { runAfter }
      } as never,
      {
        jobId: "ingestionJobs_1" as never,
        sessionToken: "token-123"
      }
    )

    expect(insert).toHaveBeenCalledWith(
      "auditEvents",
      expect.objectContaining({
        action: "ingestion.retry",
        actorLabel: "admin",
        targetId: "ingestionJobs_2",
        targetTable: "ingestionJobs"
      })
    )
  })

  it("writes an audit event when an admin login attempt fails", async () => {
    const insert = vi.fn().mockResolvedValueOnce("adminLoginAttempts_1").mockResolvedValueOnce("auditEvents_1")

    await recordLoginAttemptHandler._handler(
      {
        db: { insert }
      } as never,
      {
        successful: false,
        username: "admin"
      }
    )

    expect(insert).toHaveBeenNthCalledWith(
      1,
      "adminLoginAttempts",
      expect.objectContaining({
        successful: false,
        username: "admin"
      })
    )
    expect(insert).toHaveBeenNthCalledWith(
      2,
      "auditEvents",
      expect.objectContaining({
        action: "admin.sign_in_failed",
        actorLabel: "admin",
        actorType: "admin_auth",
        summary: "Failed sign-in attempt for admin",
        targetId: "login:admin",
        targetTable: "adminSessions"
      })
    )
  })

  it("writes an audit event when default evaluations are seeded", async () => {
    const insert = vi.fn().mockResolvedValueOnce("evaluationCases_1").mockResolvedValueOnce("auditEvents_1")

    const inserted = await seedDefaultsHandler._handler(
      {
        db: {
          insert,
          query: vi.fn().mockReturnValue({
            withIndex: vi.fn().mockReturnValue({
              unique: vi.fn().mockResolvedValue(null)
            })
          })
        }
      } as never,
      { sessionToken: "token-123" }
    )

    expect(inserted).toBe(1)
    expect(insert).toHaveBeenCalledWith(
      "auditEvents",
      expect.objectContaining({
        action: "evaluations.seed_defaults",
        actorLabel: "admin",
        targetTable: "evaluationCases"
      })
    )
  })
})
