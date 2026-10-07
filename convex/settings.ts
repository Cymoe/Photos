import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// The user's own business address/phones/emails (one per line), skipped during extraction.
export const getBusinessInfo = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("settings").first())?.businessInfo ?? "",
});

export const saveBusinessInfo = mutation({
  args: { businessInfo: v.string() },
  handler: async (ctx, { businessInfo }) => {
    const existing = await ctx.db.query("settings").first();
    if (existing) await ctx.db.patch(existing._id, { businessInfo });
    else await ctx.db.insert("settings", { businessInfo });
  },
});
