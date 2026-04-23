import { describe, expect, it } from "vitest"

import { isRetryableJob } from "./ingestion"

describe("isRetryableJob", () => {
  it("allows retry only for the latest failed job of the document", () => {
    expect(
      isRetryableJob(
        {
          _creationTime: 1,
          _id: "ingestionJobs_1" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "failed"
        },
        [
          {
            _creationTime: 1,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          }
        ]
      )
    ).toBe(true)

    expect(
      isRetryableJob(
        {
          _creationTime: 1,
          _id: "ingestionJobs_1" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "failed"
        },
        [
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
          }
        ]
      )
    ).toBe(false)

    expect(
      isRetryableJob(
        {
          _creationTime: 3,
          _id: "ingestionJobs_3" as never,
          createdAt: 3,
          documentId: "documents_2" as never,
          status: "processing_provider"
        },
        [
          {
            _creationTime: 3,
            _id: "ingestionJobs_3" as never,
            createdAt: 3,
            documentId: "documents_2" as never,
            status: "processing_provider"
          }
        ]
      )
    ).toBe(false)
  })

  it("breaks timestamp ties deterministically with Convex metadata", () => {
    expect(
      isRetryableJob(
        {
          _creationTime: 12,
          _id: "ingestionJobs_2" as never,
          createdAt: 1,
          documentId: "documents_1" as never,
          status: "failed"
        },
        [
          {
            _creationTime: 11,
            _id: "ingestionJobs_1" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          },
          {
            _creationTime: 12,
            _id: "ingestionJobs_2" as never,
            createdAt: 1,
            documentId: "documents_1" as never,
            status: "failed"
          }
        ]
      )
    ).toBe(true)
  })
})
