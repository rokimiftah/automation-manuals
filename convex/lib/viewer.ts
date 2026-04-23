import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server"

import { v } from "convex/values"

import { internalQuery } from "../_generated/server"

export type CurrentViewer = {
  canManageDocuments: boolean
  isAllowed: boolean
}

type ViewerCtx = QueryCtx | MutationCtx | ActionCtx

const viewerValidator = v.union(
  v.null(),
  v.object({
    canManageDocuments: v.boolean(),
    isAllowed: v.boolean()
  })
)

const currentViewerInternal = internalQuery({
  args: {},
  returns: viewerValidator,
  handler: async (_ctx) => {
    return {
      canManageDocuments: true,
      isAllowed: true
    }
  }
})

export async function getViewer(_ctx: ViewerCtx): Promise<CurrentViewer> {
  return {
    canManageDocuments: true,
    isAllowed: true
  }
}

export async function requireAllowedViewer(_ctx: ViewerCtx): Promise<CurrentViewer> {
  return {
    canManageDocuments: true,
    isAllowed: true
  }
}

export async function requireAdminViewer(_ctx: ViewerCtx): Promise<CurrentViewer> {
  return {
    canManageDocuments: true,
    isAllowed: true
  }
}

export { currentViewerInternal as viewer }
