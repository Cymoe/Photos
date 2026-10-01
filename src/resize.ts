// Phone photos are often 5–12 MB; the vision API caps images at 5 MB and gains
// nothing past ~2000px, so shrink before uploading. Also speeds up 300-photo batches.
const MAX_EDGE = 2000;

export async function resizeImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `Can't read ${file.name} in this browser` +
        (/\.hei[cf]$/i.test(file.name) ? " (HEIC: use Safari, or export as JPEG)" : ""),
    );
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
      "image/jpeg",
      0.88,
    ),
  );
}
