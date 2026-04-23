// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
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
            status: "waiting_provider"
          }
        ]}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText(/waiting on mineru queue/i)).toBeInTheDocument()
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
            status: "processing_provider"
          }
        ]}
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
            status: "failed"
          },
          {
            _creationTime: 2,
            _id: "ingestionJobs_2" as never,
            createdAt: 2,
            documentId: "documents_1" as never,
            status: "ready"
          },
          {
            _creationTime: 3,
            _id: "ingestionJobs_3" as never,
            createdAt: 3,
            documentId: "documents_2" as never,
            status: "failed"
          }
        ]}
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
            status: "failed"
          },
          {
            _creationTime: 12,
            _id: "ingestionJobs_2" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            errorMessage: "Newer failure",
            status: "failed"
          }
        ]}
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
})
