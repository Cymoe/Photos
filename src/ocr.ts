import { createScheduler, createWorker, type Scheduler } from "tesseract.js";

// Text recognition runs on the user's device: free, no API key. The English model
// (~10 MB) downloads once on first use and is then cached by the browser.
const WORKERS = 2;
let scheduler: Promise<Scheduler> | null = null;

function getScheduler() {
  scheduler ??= (async () => {
    const s = createScheduler();
    const workers = await Promise.all(Array.from({ length: WORKERS }, () => createWorker("eng")));
    workers.forEach((w) => s.addWorker(w));
    return s;
  })().catch((err) => {
    scheduler = null; // allow a retry if the model download failed
    throw err;
  });
  return scheduler;
}

export async function recognizeText(image: Blob): Promise<string> {
  const s = await getScheduler();
  const result = await s.addJob("recognize", image);
  return result.data.text;
}
