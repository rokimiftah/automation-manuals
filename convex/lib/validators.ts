import { v } from "convex/values"

export const documentStatusValidator = v.union(
  v.literal("draft"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("inactive")
)

export const ingestionStatusValidator = v.union(
  v.literal("queued"),
  v.literal("downloading"),
  v.literal("parsing"),
  v.literal("normalizing"),
  v.literal("embedding"),
  v.literal("ready"),
  v.literal("failed")
)

export const chunkTypeValidator = v.union(
  v.literal("text"),
  v.literal("table"),
  v.literal("diagram_description"),
  v.literal("warning"),
  v.literal("spec")
)

export const messageRoleValidator = v.union(v.literal("user"), v.literal("assistant"))

export const answerabilityStatusValidator = v.union(
  v.literal("grounded"),
  v.literal("insufficient_evidence")
)

export const severityValidator = v.union(
  v.literal("informational"),
  v.literal("operational"),
  v.literal("safety-critical")
)
