// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import IngestionJobList from "./IngestionJobList"

afterEach(() => {
  cleanup()
})

describe("IngestionJobList", () => {
  it("renders waiting provider copy for async MinerU jobs", () => {
    render(
      <IngestionJobList
        jobs={[
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            recoverableAt: undefined,
            serverNow: 1,
            status: "waiting_provider",
            updatedAt: 1
          }
        ]}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText(/pending/i)).toBeInTheDocument()
  })

  it("hides retry for jobs that have not failed", () => {
    render(
      <IngestionJobList
        jobs={[
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            recoverableAt: undefined,
            serverNow: 1,
            status: "processing_provider",
            updatedAt: 1
          }
        ]}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument()
  })

  it("shows retry only for the latest failed job per document", () => {
    render(
      <IngestionJobList
        jobs={[
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            recoverableAt: undefined,
            serverNow: 1,
            status: "failed",
            updatedAt: 1
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2" as never,
            createdAt: 2,
            documentId: "documents_1" as never,
            recoverableAt: undefined,
            serverNow: 2,
            status: "ready",
            updatedAt: 2
          },
          {
            _creationTime: 3,
            _id: "ingestionJobs_3" as never,
            createdAt: 3,
            documentId: "documents_2" as never,
            recoverableAt: undefined,
            serverNow: 3,
            status: "failed",
            updatedAt: 3
          }
        ]}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getAllByRole("button", { name: /retry/i })).toHaveLength(1)
  })

  it("breaks retry ties with Convex creation metadata when timestamps collide", () => {
    render(
      <IngestionJobList
        jobs={[
          {
            _creationTime: 11,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            errorMessage: "Older failure",
            recoverableAt: undefined,
            serverNow: 1,
            status: "failed",
            updatedAt: 1
          },
          {
            _creationTime: 12,
            _id: "ingestionJobs_2" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            errorMessage: "Newer failure",
            recoverableAt: undefined,
            serverNow: 1,
            status: "failed",
            updatedAt: 1
          }
        ]}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getAllByRole("button", { name: /retry/i })).toHaveLength(1)
    const newerJobCard = screen.getByText("Newer failure").closest("article")
    const olderJobCard = screen.getByText("Older failure").closest("article")

    expect(newerJobCard).not.toBeNull()
    expect(olderJobCard).not.toBeNull()
    expect(within(newerJobCard as HTMLElement).getByRole("button", { name: /retry/i })).toBeInTheDocument()
    expect(within(olderJobCard as HTMLElement).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument()
  })

  it("shows recover only after the server-defined recovery time", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-25T12:00:00.000Z"))

    render(
      <IngestionJobList
        jobs={[
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            errorMessage: "Older stuck job",
            recoverableAt: undefined,
            serverNow: Date.parse("2026-04-25T12:00:00.000Z"),
            status: "submitting",
            updatedAt: Date.parse("2026-04-25T11:40:00.000Z")
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2" as never,
            createdAt: 2,
            documentId: "documents_1" as never,
            errorMessage: "Newest stuck job",
            recoverableAt: Date.parse("2026-04-25T12:00:05.000Z"),
            serverNow: Date.parse("2026-04-25T12:00:00.000Z"),
            status: "normalizing",
            updatedAt: Date.parse("2026-04-25T11:40:00.000Z")
          },
          {
            _creationTime: 3,
            _id: "ingestionJobs_3" as never,
            createdAt: 3,
            documentId: "documents_2" as never,
            recoverableAt: undefined,
            serverNow: Date.parse("2026-04-25T12:00:00.000Z"),
            status: "failed",
            updatedAt: Date.parse("2026-04-25T11:59:00.000Z")
          },
          {
            _creationTime: 4,
            _id: "ingestionJobs_4" as never,
            createdAt: 4,
            documentId: "documents_3" as never,
            errorMessage: "Fresh in-flight job",
            recoverableAt: Date.parse("2026-04-25T12:10:00.000Z"),
            serverNow: Date.parse("2026-04-25T12:00:00.000Z"),
            status: "submitting",
            updatedAt: Date.parse("2026-04-25T11:59:30.000Z")
          }
        ]}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.queryByRole("button", { name: /recover/i })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.getAllByRole("button", { name: /recover/i })).toHaveLength(1)
    const newestJobCard = screen.getByText("Newest stuck job").closest("article")
    const olderJobCard = screen.getByText("Older stuck job").closest("article")
    const freshJobCard = screen.getByText("Fresh in-flight job").closest("article")

    expect(newestJobCard).not.toBeNull()
    expect(olderJobCard).not.toBeNull()
    expect(freshJobCard).not.toBeNull()
    expect(within(newestJobCard as HTMLElement).getByRole("button", { name: /recover/i })).toBeInTheDocument()
    expect(within(olderJobCard as HTMLElement).queryByRole("button", { name: /recover/i })).not.toBeInTheDocument()
    expect(within(freshJobCard as HTMLElement).queryByRole("button", { name: /recover/i })).not.toBeInTheDocument()

    vi.useRealTimers()
  })
})
