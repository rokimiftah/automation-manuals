// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import IngestionJobList from "./IngestionJobList"

describe("IngestionJobList", () => {
  it("renders waiting provider copy for async MinerU jobs", () => {
    render(
      <IngestionJobList
        jobs={[{ _id: "ingestionJobs_1" as never, documentId: "documents_1" as never, status: "waiting_provider" }]}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText(/waiting on mineru queue/i)).toBeInTheDocument()
  })
})
