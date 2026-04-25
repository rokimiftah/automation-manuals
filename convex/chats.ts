import type { Doc, Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"

import { ConvexError, v } from "convex/values"

import { internalMutation, internalQuery, query } from "./_generated/server"
import { messageRoleValidator } from "./lib/validators"

const encoder = new TextEncoder()

function createSessionAccessToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function hashSessionAccessToken(sessionAccessToken: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(sessionAccessToken))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function loadAuthorizedSession(
  ctx: Pick<QueryCtx, "db">,
  args: { sessionAccessToken: string; sessionId: Id<"chatSessions"> }
): Promise<Doc<"chatSessions"> | null> {
  const session = await ctx.db.get("chatSessions", args.sessionId)
  if (!session?.accessTokenHash) {
    return null
  }

  const accessTokenHash = await hashSessionAccessToken(args.sessionAccessToken)
  return session.accessTokenHash === accessTokenHash ? session : null
}

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

export const getSession = query({
  args: {
    sessionAccessToken: v.string(),
    sessionId: v.id("chatSessions")
  },
  returns: v.union(chatSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const session = await loadAuthorizedSession(ctx, args)
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
  args: {
    sessionAccessToken: v.string(),
    sessionId: v.id("chatSessions")
  },
  returns: v.array(chatMessageValidator),
  handler: async (ctx, args) => {
    const session = await loadAuthorizedSession(ctx, args)
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

export const getAuthorizedSession = internalQuery({
  args: {
    sessionAccessToken: v.string(),
    sessionId: v.id("chatSessions")
  },
  returns: v.union(chatSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const session = await loadAuthorizedSession(ctx, args)
    if (!session) {
      return null
    }

    return {
      _id: session._id as never,
      createdAt: session.createdAt,
      title: session.title,
      updatedAt: session.updatedAt
    }
  }
})

export const ensureSession = internalMutation({
  args: { title: v.string() },
  returns: v.object({
    sessionAccessToken: v.string(),
    sessionId: v.id("chatSessions")
  }),
  handler: async (ctx, args) => {
    const now = Date.now()
    const sessionAccessToken = createSessionAccessToken()
    const sessionAccessTokenHash = await hashSessionAccessToken(sessionAccessToken)
    const sessionId = await ctx.db.insert("chatSessions", {
      accessTokenHash: sessionAccessTokenHash,
      createdAt: now,
      title: args.title.slice(0, 120) || "New chat",
      updatedAt: now
    })

    return {
      sessionAccessToken,
      sessionId
    }
  }
})

export const appendMessage = internalMutation({
  args: {
    answerabilityStatus: v.optional(v.union(v.literal("grounded"), v.literal("insufficient_evidence"))),
    content: v.string(),
    role: messageRoleValidator,
    sessionId: v.id("chatSessions")
  },
  returns: v.id("chatMessages"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("chatSessions", args.sessionId)
    if (!session) {
      throw new ConvexError("Session not found")
    }

    const now = Date.now()
    const messageId = await ctx.db.insert("chatMessages", {
      answerabilityStatus: args.answerabilityStatus,
      content: args.content,
      createdAt: now,
      role: args.role,
      sessionId: args.sessionId
    })

    await ctx.db.patch("chatSessions", args.sessionId, { updatedAt: now })
    return messageId
  }
})
