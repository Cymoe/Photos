"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const MODEL = "claude-opus-5-5";
const MAX_RATE_LIMIT_REQUEUES = 5;

const leadSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    phone: { type: "string" },
    email: { type: "string" },
    address: { type: "string", description: "Street address only (number + street, unit)" },
    city: { type: "string" },
    state: { type: "string" },
    zip: { type: "string" },
    notes: {
      type: "string",
      description: "Anything else written next to this person (business, interest, follow-up date, etc.)",
    },
  },
  required: ["name", "phone", "email", "address", "city", "state", "zip", "notes"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { leads: { type: "array", items: leadSchema } },
  required: ["leads"],
  additionalProperties: false,
} as const;

type Lead = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

const SYSTEM_PROMPT = `You extract sales prospect contact information from photos.
Photos may show handwritten or printed sign-up sheets, notebooks, business cards, forms,
screenshots, or lists, and may contain one or many people.

Return one entry per distinct person. For each, transcribe exactly what is written:
- Use an empty string for any field that is not present. Never invent or guess values.
- Phone: keep all digits; format US numbers as (555) 555-5555 when there are 10 digits.
- If handwriting is ambiguous, give your best reading and note the uncertainty in "notes".
- Skip column headers, example rows, and crossed-out entries.
If the photo has no contact information, return an empty leads array.`;

export const extractLeads = internalAction({
  args: { photoId: v.id("photos"), attempt: v.optional(v.number()) },
  handler: async (ctx, { photoId, attempt = 0 }) => {
    const photo = await ctx.runQuery(internal.photos.get, { photoId });
    if (!photo) return;
    await ctx.runMutation(internal.photos.setStatus, { photoId, status: "processing" });

    try {
      const blob = await ctx.storage.get(photo.storageId);
      if (!blob) throw new Error("Photo file is missing from storage");
      const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const mediaType = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(blob.type)
        ? blob.type
        : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      const client = new Anthropic({ maxRetries: 4 });
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: outputSchema },
        },
        // Re-run on another model server-side if a safety classifier declines.
        betas: ["server-side-fallback-2026-07-01"],
        ...({ fallbacks: "default" } as object),
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: "Extract every prospect's contact information from this photo." },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") {
        throw new Error("The model declined to process this photo");
      }
      if (response.stop_reason === "max_tokens") {
        throw new Error("Response was cut off (too many contacts in one photo?)");
      }
      const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
      const parsed = JSON.parse(text) as { leads: Lead[] };
      const leads = parsed.leads
        .map((l) => ({
          name: l.name.trim(),
          phone: l.phone.trim(),
          email: l.email.trim(),
          address: l.address.trim(),
          city: l.city.trim(),
          state: l.state.trim(),
          zip: l.zip.trim(),
          notes: l.notes.trim(),
        }))
        .filter((l) => l.name || l.phone || l.email || l.address);

      await ctx.runMutation(internal.leads.saveExtracted, { photoId, leads });
    } catch (err) {
      // When many photos are uploaded at once we can exceed the API rate limit even
      // after the SDK's own retries; put the photo back in the queue for later.
      if (err instanceof Anthropic.RateLimitError && attempt < MAX_RATE_LIMIT_REQUEUES) {
        const delayMs = 30_000 * (attempt + 1) + Math.random() * 15_000;
        await ctx.scheduler.runAfter(delayMs, internal.extract.extractLeads, {
          photoId,
          attempt: attempt + 1,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.photos.setStatus, { photoId, status: "error", error: message });
    }
  },
});
