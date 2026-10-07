import { recognizeText } from "./ocr";
import { parseLead, type BusinessInfo } from "./parseLead";

// Reads the text in a photo and pulls out the prospect's contact details.
export async function extractLeads(image: Blob, business: BusinessInfo, takenAt?: number) {
  try {
    const ocrText = await recognizeText(image);
    const lead = parseLead(ocrText, business, takenAt);
    return lead
      ? { ocrText, leads: [lead] }
      : { ocrText, leads: [], error: "No name, phone, email or address found in this photo" };
  } catch (err) {
    return { ocrText: "", leads: [], error: `Couldn't read text: ${err instanceof Error ? err.message : err}` };
  }
}

// Keeps the iPad/phone screen on during long batches; Safari pauses work when it locks.
export async function keepScreenAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
