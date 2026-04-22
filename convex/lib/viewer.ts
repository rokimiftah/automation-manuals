import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server"
import type { GenericId } from "convex/values"

import { ConvexError, v } from "convex/values"

import { getAuthUserId } from "@convex-dev/auth/server"

import { internalQuery } from "../_generated/server"
import { computeViewerAccess } from "./roles"

export type CurrentViewer = {
  canManageDocuments: boolean
  email: string
  isAllowed: boolean
  name: string
  role: "admin" | "engineer"
  userId: GenericId<"users">
}

type ViewerCtx = QueryCtx | MutationCtx | ActionCtx

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

async function loadViewer(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    return null
  }

  const user = await ctx.db.get(userId)
  if (!user?.email) {
    return null
  }

  return buildViewer(userId, user.email, user.name)
}

const currentViewerInternal = internalQuery({
  args: {},
  returns: viewerValidator,
  handler: async (ctx) => {
    return await loadViewer(ctx)
  }
})

function buildViewer(userId: GenericId<"users">, email: string, name?: string | null): CurrentViewer {
  const access = computeViewerAccess(email)

  return {
    canManageDocuments: access.canManageDocuments,
    email,
    isAllowed: access.isAllowed,
    name: name ?? email,
    role: access.role,
    userId
  }
}

export async function getViewer(ctx: ViewerCtx): Promise<CurrentViewer | null> {
  if ("runQuery" in ctx) {
    return await ctx.runQuery(currentViewerInternal as never, {})
  }

  return await loadViewer(ctx)
}

export async function requireAllowedViewer(ctx: ViewerCtx): Promise<CurrentViewer> {
  const viewer = await getViewer(ctx)
  if (!viewer) {
    throw new ConvexError("Authentication required")
  }
  if (!viewer.isAllowed) {
    throw new ConvexError("Your account is not allowed to use this workspace")
  }

  return viewer
}

export async function requireAdminViewer(ctx: ViewerCtx): Promise<CurrentViewer> {
  const viewer = await requireAllowedViewer(ctx)
  if (!viewer.canManageDocuments) {
    throw new ConvexError("Admin access required")
  }

  return viewer
}

export { buildViewer }
