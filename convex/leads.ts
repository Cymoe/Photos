import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const phoneKey = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  // Treat a leading US country code as optional so "1-555-..." matches "555-...".
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

export const STATUSES = ["new", "contacted", "scheduled", "sent", "won", "lost"] as const;
const statusValidator = v.union(...STATUSES.map((s) => v.literal(s)));

// One person can appear in several screenshots; status and notes follow the person.
export const personKey = (l: { phoneKey?: string; email: string; name: string }) =>
  l.phoneKey || l.email.toLowerCase() || l.name.toLowerCase().replace(/\s+/g, " ").trim();

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
      status: l.status ?? "new",
      myNotes: l.myNotes ?? "",
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
      v.literal("myNotes"),
    ),
    value: v.string(),
  },
  handler: async (ctx, { leadId, field, value }) => {
    const patch: Record<string, string> = { [field]: value };
    if (field === "phone") patch.phoneKey = phoneKey(value);
    await ctx.db.patch(leadId, patch);
  },
});

// Moves leads (all screenshots of one person) to a pipeline stage.
export const setStatus = mutation({
  args: { leadIds: v.array(v.id("leads")), status: statusValidator },
  handler: async (ctx, { leadIds, status }) => {
    const now = Date.now();
    for (const id of leadIds) await ctx.db.patch(id, { status, statusChangedAt: now });
  },
});

export const setMyNotes = mutation({
  args: { leadIds: v.array(v.id("leads")), myNotes: v.string() },
  handler: async (ctx, { leadIds, myNotes }) => {
    for (const id of leadIds) await ctx.db.patch(id, { myNotes });
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
  // Re-reading a photo must not lose pipeline progress: carry status/notes over to the
  // matching new lead (same person, or the only lead when the photo has just one).
  const kept = new Map(existing.map((l) => [personKey(l), l]));
  for (const lead of existing) await ctx.db.delete(lead._id);
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    const prior =
      kept.get(personKey({ ...lead, phoneKey: key })) ??
      (existing.length === 1 && leads.length === 1 ? existing[0] : undefined) ??
      // A new screenshot of someone already in the pipeline joins them where they are.
      (key ? await ctx.db.query("leads").withIndex("by_phoneKey", (q) => q.eq("phoneKey", key)).first() : null) ??
      undefined;
    await ctx.db.insert("leads", {
      ...lead,
      photoId,
      phoneKey: key,
      ...(prior?.status && { status: prior.status, statusChangedAt: prior.statusChangedAt }),
      ...(prior?.myNotes && { myNotes: prior.myNotes }),
    });
  }
}
