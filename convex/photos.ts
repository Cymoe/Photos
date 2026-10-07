import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { leadFields, replaceLeads } from "./leads";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

const resultArgs = {
  ocrText: v.string(),
  leads: v.array(v.object(leadFields)),
  error: v.optional(v.string()),
};

// Called by the browser after it has read the photo's text and uploaded the image.
export const savePhoto = mutation({
  args: { storageId: v.id("_storage"), fileName: v.string(), takenAt: v.optional(v.number()), ...resultArgs },
  handler: async (ctx, { storageId, fileName, takenAt, ocrText, leads, error }) => {
    const photoId = await ctx.db.insert("photos", {
      storageId,
      fileName,
      takenAt,
      ocrText,
      status: error ? "error" : "done",
      error,
      leadCount: leads.length,
    });
    await replaceLeads(ctx, photoId, leads);
    return photoId;
  },
});

// Called after the browser re-reads an already-uploaded photo.
export const saveResult = mutation({
  args: { photoId: v.id("photos"), ...resultArgs },
  handler: async (ctx, { photoId, ocrText, leads, error }) => {
    await replaceLeads(ctx, photoId, leads);
    await ctx.db.patch(photoId, {
      ocrText,
      status: error ? "error" : "done",
      error,
      leadCount: leads.length,
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const photos = await ctx.db.query("photos").order("desc").collect();
    return Promise.all(
      photos.map(async ({ ocrText: _ocrText, ...p }) => ({ ...p, url: await ctx.storage.getUrl(p.storageId) })),
    );
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
