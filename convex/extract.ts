"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Override with the OPENAI_MODEL environment variable in Convex if desired.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
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

// Pull the human-readable message out of an API error body instead of showing raw JSON.
function apiErrorMessage(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.code === "insufficient_quota") {
      return "OpenAI account has no credits. Add credits at platform.openai.com/settings/organization/billing";
    }
    return `${err.status ?? ""} ${err.message}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

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
      const mediaType = blob.type.startsWith("image/") ? blob.type : "image/jpeg";

      const client = new OpenAI({ maxRetries: 4 });
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract every prospect's contact information from this photo." },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}`, detail: "high" } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "leads", strict: true, schema: outputSchema },
        },
      });

      const choice = completion.choices[0];
      if (choice.message.refusal) {
        throw new Error(`The model declined to process this photo: ${choice.message.refusal}`);
      }
      if (choice.finish_reason === "length") {
        throw new Error("Response was cut off (too many contacts in one photo?)");
      }
      const text = choice.message.content ?? "";
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
      // (An empty-balance account also returns 429, but retrying won't help that.)
      if (
        err instanceof OpenAI.RateLimitError &&
        err.code !== "insufficient_quota" &&
        attempt < MAX_RATE_LIMIT_REQUEUES
      ) {
        const delayMs = 30_000 * (attempt + 1) + Math.random() * 15_000;
        await ctx.scheduler.runAfter(delayMs, internal.extract.extractLeads, {
          photoId,
          attempt: attempt + 1,
        });
        return;
      }
      const message = apiErrorMessage(err);
      console.error(`Extraction failed for ${photo.fileName}:`, message);
      await ctx.runMutation(internal.photos.setStatus, { photoId, status: "error", error: message });
    }
  },
});
