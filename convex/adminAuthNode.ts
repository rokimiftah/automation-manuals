"use node"

import { randomBytes } from "node:crypto"

import { ConvexError, v } from "convex/values"

import { argon2Verify } from "hash-wasm"

import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { authenticateAdminLogin, getAdminAuthEnv, getAdminLoginAttemptUsername, getRateLimitState } from "./lib/adminSession"

const LOGIN_LIMIT = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

export const signInWithPassword = internalAction({
  args: {
    password: v.string(),
    username: v.string()
  },
  returns: v.object({
    expiresAt: v.number(),
    sessionToken: v.string(),
    username: v.string()
  }),
  handler: async (ctx, args) => {
    const env = getAdminAuthEnv()
    const now = Date.now()
    const attemptUsername = getAdminLoginAttemptUsername(args.username)

    const attempts = await ctx.runQuery(internal.adminAuth.listRecentLoginAttempts, {
      username: attemptUsername,
      windowStart: now - LOGIN_WINDOW_MS
    })

    const failures = attempts
      .filter((attempt: { successful: boolean; createdAt: number }) => !attempt.successful)
      .map((attempt: { successful: boolean; createdAt: number }) => attempt.createdAt)
    const rateLimitState = getRateLimitState({
      failures,
      limit: LOGIN_LIMIT,
      now,
      windowMs: LOGIN_WINDOW_MS
    })
    if (rateLimitState) {
      throw new ConvexError("Too many login attempts. Please try again later.")
    }

    const login = await authenticateAdminLogin(
      {
        env,
        password: args.password,
        username: args.username
      },
      {
        verifyPasswordHash: (passwordHash, password) => argon2Verify({ hash: passwordHash, password })
      }
    )

    if (!login) {
      await ctx.runMutation(internal.adminAuth.recordLoginAttempt, { successful: false, username: attemptUsername })
      throw new ConvexError("Invalid admin credentials")
    }

    const sessionToken = randomBytes(32).toString("base64url")
    const expiresAt = now + env.sessionTtlMs

    await ctx.runMutation(internal.adminAuth.recordLoginAttempt, { successful: true, username: attemptUsername })
    await ctx.runMutation(internal.adminAuth.createSession, {
      expiresAt,
      sessionToken,
      username: login.username
    })

    return {
      expiresAt,
      sessionToken,
      username: login.username
    }
  }
})
