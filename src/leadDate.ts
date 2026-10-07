// Finds when a lead came in from the date headers in a conversation screenshot
// ("Oct 1, 2026", "10/1/26", "Yesterday", "Tuesday"), falling back to when the
// screenshot itself was taken. Returns YYYY-MM-DD, or "" when unknown.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MONTH_DAY =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i;
const NUMERIC = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/;
// Header-style lines only ("Yesterday", "Facebook • Yesterday 3:25 AM", "Tuesday 4:43 PM"),
// so a message like "Saturday works for me" isn't mistaken for a date.
const TIME = String.raw`(?:\s*\d{1,2}:\d{2}\s*[ap]\.?m\.?)?`;
const PREFIX = String.raw`^(?:[A-Za-z]+\s*[•·+*-]\s*)?`;
const RELATIVE = new RegExp(`${PREFIX}(today|yesterday)${TIME}$`, "i");
const WEEKDAY = new RegExp(`${PREFIX}(sun|mon|tue|wed|thu|fri|sat)(?:day|s|nes|nesday|rs|rsday|urday)?${TIME}$`, "i");

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dateOnLine(line: string, ref: Date | undefined): Date | null {
  const now = ref ?? new Date();
  let m = line.match(MONTH_DAY);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const day = Number(m[2]);
    if (day < 1 || day > 31) return null;
    if (m[3]) return new Date(Number(m[3]), month, day);
    // No year shown (recent messages): the most recent such date not after the reference.
    const d = new Date(now.getFullYear(), month, day);
    if (d > now) d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  m = line.match(NUMERIC);
  if (m) {
    const [month, day] = [Number(m[1]) - 1, Number(m[2])];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (month > 11 || day < 1 || day > 31) return null;
    return new Date(year, month, day);
  }
  // Relative headers only make sense if we know when the screenshot was taken.
  if (!ref) return null;
  m = line.match(RELATIVE);
  if (m) {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    if (m[1].toLowerCase() === "yesterday") d.setDate(d.getDate() - 1);
    return d;
  }
  m = line.match(WEEKDAY);
  if (m) {
    const target = WEEKDAYS.indexOf(m[1].slice(0, 3).toLowerCase());
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const back = (d.getDay() - target + 7) % 7 || 7; // "Tuesday" means within the past week
    d.setDate(d.getDate() - back);
    return d;
  }
  return null;
}

// `anchor` is the line where the prospect's details start; the date header that
// precedes it is the one that applies.
export function findLeadDate(lines: string[], anchor: number | undefined, takenAt?: number): string {
  const ref = takenAt ? new Date(takenAt) : undefined;
  const dated = lines
    .map((line, i) => ({ i, d: dateOnLine(line, ref) }))
    .filter((x): x is { i: number; d: Date } => x.d !== null && !Number.isNaN(x.d.getTime()));
  if (dated.length) {
    const before = anchor === undefined ? [] : dated.filter((x) => x.i <= anchor);
    return iso((before.at(-1) ?? dated[0]).d);
  }
  return ref ? iso(ref) : "";
}
