import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { GenericId } from "convex/values"

import { ConvexError, v } from "convex/values"

import { internalMutation, query } from "./_generated/server"
import { messageRoleValidator } from "./lib/validators"
import { requireAllowedViewer } from "./lib/viewer"

const chatSessionValidator = v.object({
  _id: v.id("chatSessions"),
  createdAt: v.number(),
  title: v.string(),
  updatedAt: v.number()
})

const chatMessageValidator = v.object({
  _id: v.id("chatMessages"),
  content: v.string(),
  role: messageRoleValidator
})

type OwnedSessionCtx = QueryCtx | MutationCtx

async function requireOwnedSession(ctx: OwnedSessionCtx, sessionId: GenericId<"chatSessions">) {
  const viewer = await requireAllowedViewer(ctx)
  const session = await ctx.db.get(sessionId)
  if (!session || session.userId !== viewer.userId) {
    return null
  }

  return session
}

function normalizeTitle(title?: string) {
  const trimmed = title?.trim()
  return trimmed ? trimmed.slice(0, 120) : "New chat"
}

export const getSession = query({
  args: { sessionId: v.id("chatSessions") },
  returns: v.union(chatSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId)
    if (!session) {
      return null
    }

    return {
      _id: session._id,
      createdAt: session.createdAt,
      title: session.title,
      updatedAt: session.updatedAt
    }
  }
})

export const listMessages = query({
  args: { sessionId: v.id("chatSessions") },
  returns: v.array(chatMessageValidator),
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId)
    if (!session) {
      return []
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()

    return messages
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime)
      .map((message) => ({
        _id: message._id,
        content: message.content,
        role: message.role
      }))
  }
})

export const ensureSession = internalMutation({
  args: {
    title: v.string(),
    userId: v.id("users")
  },
  returns: v.id("chatSessions"),
  handler: async (ctx, args) => {
    const now = Date.now()

    return await ctx.db.insert("chatSessions", {
      createdAt: now,
      title: normalizeTitle(args.title),
      updatedAt: now,
      userId: args.userId
    })
  }
})

export const appendMessage = internalMutation({
  args: {
    answerabilityStatus: v.optional(v.union(v.literal("grounded"), v.literal("insufficient_evidence"))),
    content: v.string(),
    role: messageRoleValidator,
    sessionId: v.id("chatSessions"),
    userId: v.id("users")
  },
  returns: v.id("chatMessages"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session || session.userId !== args.userId) {
      throw new ConvexError("Session not found")
    }

    const now = Date.now()
    const messageId = await ctx.db.insert("chatMessages", {
      answerabilityStatus: args.answerabilityStatus,
      content: args.content,
      createdAt: now,
      role: args.role,
      sessionId: args.sessionId,
      userId: args.userId
    })

    await ctx.db.patch(args.sessionId, {
      updatedAt: now
    })

    return messageId
  }
})
