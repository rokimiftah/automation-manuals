import { v } from "convex/values"

import { internal } from "./_generated/api"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import {
  buildAdminAuditActor,
  hashSessionToken,
  loadValidAdminSession,
  requireAdminQuerySession,
  revokeAdminSession
} from "./lib/adminSession"

const adminSessionViewValidator = v.object({
  expiresAt: v.number(),
  username: v.string()
})

export const signIn = action({
  args: {
    password: v.string(),
    username: v.string()
  },
  returns: v.object({
    expiresAt: v.number(),
    sessionToken: v.string(),
    username: v.string()
  }),
  handler: async (ctx, args): Promise<{ expiresAt: number; sessionToken: string; username: string }> => {
    return await ctx.runAction(internal.adminAuthNode.signInWithPassword, args)
  }
})

export const validateSession = query({
  args: { sessionToken: v.string() },
  returns: v.union(v.null(), adminSessionViewValidator),
  handler: async (ctx, args) => {
    const session = await loadValidAdminSession(ctx, args.sessionToken)
    if (!session) {
      return null
    }

    return {
      expiresAt: session.expiresAt,
      username: session.username
    }
  }
})

export const signOut = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireAdminQuerySession(ctx, args.sessionToken)

    await revokeAdminSession(ctx, session._id)
    await ctx.db.insert("auditEvents", {
      ...buildAdminAuditActor(session),
      action: "admin.sign_out",
      targetTable: "adminSessions",
      targetId: session._id,
      summary: `Signed out ${session.username}`,
      createdAt: Date.now()
    })

    return null
  }
})

export const listRecentLoginAttempts = internalQuery({
  args: {
    username: v.string(),
    windowStart: v.number()
  },
  returns: v.array(v.object({ createdAt: v.number(), successful: v.boolean() })),
  handler: async (ctx, args) => {
    const attempts = await ctx.db
      .query("adminLoginAttempts")
      .withIndex("by_username_and_created_at", (q) => q.eq("username", args.username).gte("createdAt", args.windowStart))
      .collect()

    return attempts.map((attempt) => ({
      createdAt: attempt.createdAt,
      successful: attempt.successful
    }))
  }
})

export const recordLoginAttempt = internalMutation({
  args: {
    successful: v.boolean(),
    username: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("adminLoginAttempts", {
      createdAt: Date.now(),
      successful: args.successful,
      username: args.username
    })
    return null
  }
})

export const createSession = internalMutation({
  args: {
    expiresAt: v.number(),
    sessionToken: v.string(),
    username: v.string()
  },
  returns: v.id("adminSessions"),
  handler: async (ctx, args) => {
    const tokenHash = await hashSessionToken(args.sessionToken)
    const createdAt = Date.now()

    const sessionId = await ctx.db.insert("adminSessions", {
      createdAt,
      expiresAt: args.expiresAt,
      tokenHash,
      username: args.username
    })

    await ctx.db.insert("auditEvents", {
      ...buildAdminAuditActor({ _id: sessionId, username: args.username }),
      action: "admin.sign_in",
      targetTable: "adminSessions",
      targetId: sessionId,
      summary: `Signed in ${args.username}`,
      createdAt
    })

    await ctx.scheduler.runAfter(Math.max(0, args.expiresAt - createdAt), internal.adminAuth.expireSession, { sessionId })
    return sessionId
  }
})

export const expireSession = internalMutation({
  args: { sessionId: v.id("adminSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("adminSessions", args.sessionId)
    if (!session || session.revokedAt !== undefined) {
      return null
    }

    await revokeAdminSession(ctx, args.sessionId)
    return null
  }
})
