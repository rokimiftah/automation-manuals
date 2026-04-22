import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { defaultEvaluationCases } from "./lib/evaluationSeed"
import { requireAdminViewer } from "./lib/viewer"
import { severityValidator } from "./lib/validators"

const evaluationCaseValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("evaluationCases"),
  category: v.string(),
  expectedDocumentTitle: v.string(),
  expectedPageNumbers: v.array(v.number()),
  expectedRefusal: v.boolean(),
  question: v.string(),
  severity: severityValidator,
  slug: v.string()
})

export const list = query({
  args: {},
  returns: v.array(evaluationCaseValidator),
  handler: async (ctx) => {
    return await ctx.db.query("evaluationCases").collect()
  }
})

export const seedDefaults = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdminViewer(ctx)

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

    return inserted
  }
})
