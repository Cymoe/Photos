import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const phoneKey = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  // Treat a leading US country code as optional so "1-555-..." matches "555-...".
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

export const leadFields = {
  date: v.string(),
  name: v.string(),
  phone: v.string(),
  email: v.string(),
  address: v.string(),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  notes: v.string(),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const leads = await ctx.db.query("leads").order("asc").collect();
    const photos = new Map(
      (await ctx.db.query("photos").collect()).map((p) => [p._id, p.fileName]),
    );
    const phoneCounts = new Map<string, number>();
    for (const l of leads) {
      if (l.phoneKey) phoneCounts.set(l.phoneKey, (phoneCounts.get(l.phoneKey) ?? 0) + 1);
    }
    return leads.map((l) => ({
      ...l,
      date: l.date ?? "",
      fileName: photos.get(l.photoId) ?? "",
      duplicate: !!l.phoneKey && (phoneCounts.get(l.phoneKey) ?? 0) > 1,
    }));
  },
});

export const update = mutation({
  args: {
    leadId: v.id("leads"),
    field: v.union(
      v.literal("date"),
      v.literal("name"),
      v.literal("phone"),
      v.literal("email"),
      v.literal("address"),
      v.literal("city"),
      v.literal("state"),
      v.literal("zip"),
      v.literal("notes"),
    ),
    value: v.string(),
  },
  handler: async (ctx, { leadId, field, value }) => {
    const patch: Record<string, string> = { [field]: value };
    if (field === "phone") patch.phoneKey = phoneKey(value);
    await ctx.db.patch(leadId, patch);
  },
});

export const remove = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    await ctx.db.delete(leadId);
  },
});

// Replaces any previous leads for the photo, so re-extracting is idempotent.
export async function replaceLeads(
  ctx: MutationCtx,
  photoId: Id<"photos">,
  leads: { date: string; name: string; phone: string; email: string; address: string; city: string; state: string; zip: string; notes: string }[],
) {
  const existing = await ctx.db
    .query("leads")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  for (const lead of existing) await ctx.db.delete(lead._id);
  for (const lead of leads) {
    await ctx.db.insert("leads", { ...lead, photoId, phoneKey: phoneKey(lead.phone) });
  }
}
