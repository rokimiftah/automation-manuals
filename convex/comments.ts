import { v } from "convex/values"

import { mutation, query } from "./_generated/server"

const commentValidator = v.object({
  _id: v.id("comments"),
  _creationTime: v.number(),
  author: v.string(),
  content: v.string()
})

export const create = mutation({
  args: {
    author: v.string(),
    content: v.string()
  },
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("comments", {
      author: args.author,
      content: args.content
    })
  }
})

export const list = query({
  args: {},
  returns: v.array(commentValidator),
  handler: async (ctx) => {
    return await ctx.db.query("comments").order("desc").collect()
  }
})
