// Reads when a photo/screenshot was taken from its embedded EXIF data (JPEG APP1 or
// PNG eXIf chunk). Must run on the original file: resizing through a canvas drops it.
export async function readPhotoDate(file: Blob): Promise<number | undefined> {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    const tiff = findTiff(buf);
    return tiff === null ? undefined : readTiffDate(buf, tiff);
  } catch {
    return undefined;
  }
}

function findTiff(v: DataView): number | null {
  if (v.getUint16(0) === 0xffd8) {
    // JPEG: walk segments looking for APP1 "Exif\0\0"
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return off + 10;
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      off += 2 + len;
    }
  } else if (v.getUint32(0) === 0x89504e47) {
    // PNG: walk chunks looking for "eXIf"
    let off = 8;
    while (off + 8 < v.byteLength) {
      const len = v.getUint32(off);
      if (v.getUint32(off + 4) === 0x65584966) return off + 8;
      off += 12 + len;
    }
  }
  return null;
}

function readTiffDate(v: DataView, tiff: number): number | undefined {
  const le = v.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => v.getUint16(tiff + o, le);
  const u32 = (o: number) => v.getUint32(tiff + o, le);
  const ascii = (o: number, n: number) =>
    Array.from({ length: n }, (_, k) => String.fromCharCode(v.getUint8(tiff + o + k))).join("");

  const readIfd = (ifd: number) => {
    const tags = new Map<number, number>();
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
      const e = ifd + 2 + k * 12;
      tags.set(u16(e), e);
    }
    return tags;
  };
  // Tag values: 0x8769 = Exif sub-IFD pointer, 0x9003 = DateTimeOriginal, 0x0132 = DateTime
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr !== undefined ? readIfd(u32(exifPtr + 8)) : new Map<number, number>();
  const entry = exif.get(0x9003) ?? ifd0.get(0x0132);
  if (entry === undefined) return undefined;
  const m = ascii(u32(entry + 8), 19).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const t = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isNaN(t) ? undefined : t;
}
