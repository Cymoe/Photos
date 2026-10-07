import { recognizeText } from "./ocr";
import { parseLead } from "./parseLead";

// Reads the text in a photo and pulls out the prospect's contact details.
export async function extractLeads(image: Blob) {
  try {
    const ocrText = await recognizeText(image);
    const lead = parseLead(ocrText);
    return lead
      ? { ocrText, leads: [lead] }
      : { ocrText, leads: [], error: "No name, phone, email or address found in this photo" };
  } catch (err) {
    return { ocrText: "", leads: [], error: `Couldn't read text: ${err instanceof Error ? err.message : err}` };
  }
}
