import { v } from "convex/values"

import { internalQuery, mutation } from "./_generated/server"
import { insertAdminAuditEvent, requireAdminWriteSession } from "./lib/adminSession"
import { defaultEvaluationCases } from "./lib/evaluationSeed"
import { answerabilityStatusValidator, severityValidator } from "./lib/validators"

const evaluationCaseValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("evaluationCases"),
  category: v.string(),
  expectedAnswerabilityStatus: v.optional(answerabilityStatusValidator),
  expectedDocumentTitle: v.string(),
  expectedPageNumbers: v.array(v.number()),
  expectedRefusal: v.boolean(),
  question: v.string(),
  severity: severityValidator,
  slug: v.string()
})

export const list = internalQuery({
  args: {},
  returns: v.array(evaluationCaseValidator),
  handler: async (ctx) => {
    return await ctx.db.query("evaluationCases").collect()
  }
})

export const seedDefaults = mutation({
  args: { sessionToken: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const adminSession = await requireAdminWriteSession(ctx, args.sessionToken)
    let inserted = 0
    for (const item of defaultEvaluationCases) {
      const existing = await ctx.db
        .query("evaluationCases")
        .withIndex("by_slug", (q) => q.eq("slug", item.slug))
        .unique()

      if (existing) {
        continue
      }

      await ctx.db.insert("evaluationCases", item)
      inserted += 1
    }

    await insertAdminAuditEvent(ctx, adminSession, {
      action: "evaluations.seed_defaults",
      targetId: `default:${inserted}`,
      targetTable: "evaluationCases",
      summary: `Seeded ${inserted} default evaluation case${inserted === 1 ? "" : "s"}`
    })

    return inserted
  }
})
