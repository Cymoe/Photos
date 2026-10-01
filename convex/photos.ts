import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

// Called by the browser after a photo finishes uploading. Queues extraction.
export const savePhoto = mutation({
  args: { storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { storageId, fileName }) => {
    const photoId = await ctx.db.insert("photos", {
      storageId,
      fileName,
      status: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.extract.extractLeads, { photoId });
    return photoId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const photos = await ctx.db.query("photos").order("desc").collect();
    return Promise.all(
      photos.map(async (p) => ({ ...p, url: await ctx.storage.getUrl(p.storageId) })),
    );
  },
});

export const retry = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();
    for (const lead of existing) await ctx.db.delete(lead._id);
    await ctx.db.patch(photoId, { status: "pending", error: undefined, leadCount: undefined });
    await ctx.scheduler.runAfter(0, internal.extract.extractLeads, { photoId });
  },
});

export const retryAllFailed = mutation({
  args: {},
  handler: async (ctx) => {
    const failed = await ctx.db
      .query("photos")
      .withIndex("by_status", (q) => q.eq("status", "error"))
      .collect();
    for (const [i, p] of failed.entries()) {
      await ctx.db.patch(p._id, { status: "pending", error: undefined });
      // Stagger retries so we don't hit API rate limits all at once.
      await ctx.scheduler.runAfter(i * 2000, internal.extract.extractLeads, { photoId: p._id });
    }
    return failed.length;
  },
});

export const remove = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return;
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();
    for (const lead of leads) await ctx.db.delete(lead._id);
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(photoId);
  },
});

// ---- internal helpers used by the extraction action ----

export const get = internalQuery({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => ctx.db.get(photoId),
});

export const setStatus = internalMutation({
  args: {
    photoId: v.id("photos"),
    status: v.union(v.literal("processing"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { photoId, status, error }) => {
    await ctx.db.patch(photoId, { status, error });
  },
});
