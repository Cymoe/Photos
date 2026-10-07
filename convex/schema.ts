import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  photos: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
    // Raw recognized text, kept so bad extractions can be diagnosed.
    ocrText: v.optional(v.string()),
    leadCount: v.optional(v.number()),
  }).index("by_status", ["status"]),

  leads: defineTable({
    photoId: v.id("photos"),
    name: v.string(),
    phone: v.string(),
    email: v.string(),
    address: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    notes: v.string(),
    // Normalized digits-only phone, used to spot duplicates across photos.
    phoneKey: v.string(),
  })
    .index("by_photo", ["photoId"])
    .index("by_phoneKey", ["phoneKey"]),
});
