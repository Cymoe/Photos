import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { leadFields, personKey, replaceLeads } from "./leads";

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
  args: { photoId: v.id("photos"), takenAt: v.optional(v.number()), ...resultArgs },
  handler: async (ctx, { photoId, takenAt, ocrText, leads, error }) => {
    await replaceLeads(ctx, photoId, leads);
    await ctx.db.patch(photoId, {
      ...(takenAt !== undefined && { takenAt }),
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

// Deletes only the image: its leads (with their stage and notes) are kept, just no
// longer linked to a photo. Leads are deleted separately, from the Table.
export const remove = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return;
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();
    for (const lead of leads) await ctx.db.patch(lead._id, { photoId: undefined });
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(photoId);
  },
});

// Photos uploaded more than once: same file name (ignoring generic "image.jpg") or the
// exact same recognized text. Keeps the copy with a capture date, else the oldest.
async function findDuplicatePhotos(ctx: QueryCtx) {
  const photos = await ctx.db.query("photos").collect();
  photos.sort((a, b) => Number(b.takenAt !== undefined) - Number(a.takenAt !== undefined) || a._creationTime - b._creationTime);
  const owner = new Map<string, Doc<"photos">>();
  const dupes: { dupe: Doc<"photos">; keep: Doc<"photos"> }[] = [];
  for (const p of photos) {
    const keys = [
      !/^image\.\w+$/i.test(p.fileName) && `f:${p.fileName}`,
      p.ocrText?.trim() && `t:${p.ocrText.replace(/\s+/g, " ").trim()}`,
    ].filter((k): k is string => !!k);
    const keep = keys.map((k) => owner.get(k)).find(Boolean);
    if (keep) dupes.push({ dupe: p, keep });
    else for (const k of keys) owner.set(k, p);
  }
  return dupes;
}

export const duplicateCount = query({
  args: {},
  handler: async (ctx) => (await findDuplicatePhotos(ctx)).length,
});

export const removeDuplicates = mutation({
  args: {},
  handler: async (ctx) => {
    const dupes = await findDuplicatePhotos(ctx);
    for (const { dupe, keep } of dupes) {
      const leadsOf = (photoId: Doc<"photos">["_id"]) =>
        ctx.db.query("leads").withIndex("by_photo", (q) => q.eq("photoId", photoId)).collect();
      const kept = await leadsOf(keep._id);
      // Don't lose pipeline progress recorded on the copy being removed.
      for (const lead of await leadsOf(dupe._id)) {
        const target = kept.find((k) => personKey(k) === personKey(lead)) ?? (kept.length === 1 ? kept[0] : undefined);
        if (target) {
          const newer = (lead.statusChangedAt ?? 0) > (target.statusChangedAt ?? 0);
          await ctx.db.patch(target._id, {
            ...(lead.status && newer && { status: lead.status, statusChangedAt: lead.statusChangedAt }),
            ...(lead.myNotes && !target.myNotes && { myNotes: lead.myNotes }),
            ...(!target.date && lead.date && { date: lead.date }),
            ...(lead.appointmentAt && !target.appointmentAt && { appointmentAt: lead.appointmentAt }),
          });
        }
        await ctx.db.delete(lead._id);
      }
      if (dupe.takenAt !== undefined && keep.takenAt === undefined) await ctx.db.patch(keep._id, { takenAt: dupe.takenAt });
      await ctx.storage.delete(dupe.storageId);
      await ctx.db.delete(dupe._id);
    }
    return dupes.length;
  },
});
