import { v } from "convex/values"

import { query } from "./_generated/server"

const viewerValidator = v.object({
  canManageDocuments: v.boolean(),
  isAllowed: v.boolean()
})

export const current = query({
  args: {},
  returns: viewerValidator,
  handler: async () => {
    return {
      canManageDocuments: true,
      isAllowed: true
    }
  }
})
