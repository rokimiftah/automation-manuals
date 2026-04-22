import { v } from "convex/values"

import { query } from "./_generated/server"
import { getViewer } from "./lib/viewer"

const viewerValidator = v.union(
  v.null(),
  v.object({
    canManageDocuments: v.boolean(),
    email: v.string(),
    isAllowed: v.boolean(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("engineer")),
    userId: v.id("users")
  })
)

export const current = query({
  args: {},
  returns: viewerValidator,
  handler: async (ctx) => {
    return await getViewer(ctx)
  }
})
