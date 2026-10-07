// Turns OCR text from a lead screenshot (CRM message, form notification, SMS) into a
// contact record. Labeled fields ("Phone: ...") win; unlabeled phone/email are a fallback.

export type Lead = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATES));
const STATE_PATTERN = [...Object.keys(STATES), ...STATE_CODES].sort((a, b) => b.length - a.length).join("|");

const STREET_SUFFIX =
  "St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Cir|Circle|" +
  "Hwy|Highway|Pkwy|Parkway|Trl|Trail|Ter|Terrace|Loop|Run|Pass|Sq|Square|Fwy|Expy";

// Label -> field. Order matters: more specific labels first.
const LABELS: [RegExp, keyof Lead | "first" | "last"][] = [
  [/^(?:first\s*name)$/i, "first"],
  [/^(?:last\s*name|surname)$/i, "last"],
  [/^(?:full\s*name|name|contact(?:\s*name)?|customer(?:\s*name)?|client(?:\s*name)?|lead(?:\s*name)?)$/i, "name"],
  [/^(?:phone(?:\s*number)?|mobile(?:\s*phone)?|cell(?:\s*phone)?|tel(?:ephone)?|number|ph)$/i, "phone"],
  [/^(?:e-?\s*mail(?:\s*address)?)$/i, "email"],
  [/^(?:(?:street|home|property|service|mailing)?\s*address(?:\s*line\s*1)?|street)$/i, "address"],
  [/^city$/i, "city"],
  [/^(?:state|province)$/i, "state"],
  [/^(?:zip(?:\s*code)?|postal(?:\s*code)?)$/i, "zip"],
];

// System lines that carry phone numbers that are NOT the prospect's.
const IGNORE_LINE = /\b(using|to send sms|sent from|from:|to:)\b/i;

const EMAIL_RE = /[A-Z0-9._%+-]+\s?@\s?[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]*)?\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/;

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw.trim();
}

function cleanEmail(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[.,;]+$/, "").toLowerCase();
}

// "1417 Golder Ave Odessa Texas 79761" -> street/city/state/zip
export function splitAddress(raw: string): Pick<Lead, "address" | "city" | "state" | "zip"> {
  let rest = raw.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
  let zip = "";
  let state = "";
  let city = "";
  const zipMatch = rest.match(/,?\s*(\d{5})(?:-\d{4})?$/);
  if (zipMatch) {
    zip = zipMatch[1];
    rest = rest.slice(0, zipMatch.index).replace(/[,\s]+$/, "");
  }
  const stateMatch = rest.match(new RegExp(`[,\\s]+(${STATE_PATTERN})\\.?$`, "i"));
  if (stateMatch) {
    const s = stateMatch[1];
    state = STATES[s.toLowerCase()] ?? s.toUpperCase();
    rest = rest.slice(0, stateMatch.index).replace(/[,\s]+$/, "");
  }
  if (rest.includes(",")) {
    const i = rest.lastIndexOf(",");
    city = rest.slice(i + 1).trim();
    rest = rest.slice(0, i).trim();
  } else if (state) {
    // No comma: city is whatever follows the street suffix (or unit number).
    const m = rest.match(new RegExp(`^(.*?\\b(?:${STREET_SUFFIX})\\.?(?:\\s+(?:#|apt|unit|ste|suite)\\.?\\s*\\w+)?)\\s+(.+)$`, "i"));
    if (m) {
      rest = m[1];
      city = m[2];
    }
  }
  return { address: rest, city, state, zip };
}

// The user's own business details, which appear in screenshots but aren't the prospect's.
export type BusinessInfo = { addresses: string[]; phones: string[]; emails: string[] };

const ABBREV: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", boulevard: "blvd", court: "ct",
  highway: "hwy", parkway: "pkwy", east: "e", west: "w", north: "n", south: "s",
};
// "801 East County Road 121, Midland" -> "801 e county": house number + first street words,
// tolerant of abbreviations and OCR punctuation differences.
const addressKey = (a: string) =>
  a.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
    .map((w) => ABBREV[w] ?? w).slice(0, 3).join(" ");
const digitsKey = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

// One item per line; each line is classified as an email, a phone number or an address.
export function parseBusinessInfo(text: string): BusinessInfo {
  const info: BusinessInfo = { addresses: [], phones: [], emails: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (EMAIL_RE.test(line)) info.emails.push(cleanEmail(line.match(EMAIL_RE)![0]));
    else if (/^[\d\s()+.-]+$/.test(line) && digitsKey(line).length >= 10) info.phones.push(digitsKey(line));
    else info.addresses.push(addressKey(line));
  }
  return info;
}

const NO_BUSINESS: BusinessInfo = { addresses: [], phones: [], emails: [] };

export function parseLead(text: string, business: BusinessInfo = NO_BUSINESS): Lead | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[|]/g, "").trim())
    .filter(Boolean);

  const isBusiness = (field: string, value: string) =>
    (field === "address" && business.addresses.includes(addressKey(value))) ||
    (field === "phone" && business.phones.includes(digitsKey(value.match(PHONE_RE)?.[0] ?? value))) ||
    (field === "email" && business.emails.includes(cleanEmail(value.match(EMAIL_RE)?.[0] ?? value)));

  // Every labeled value with the line it was on; a screenshot can contain several
  // (e.g. the business's own "Address:" in an outgoing message).
  const candidates: Partial<Record<keyof Lead | "first" | "last", { value: string; line: number }[]>> = {};
  const notes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z][A-Za-z\s-]{0,30}?)\s*[:;]\s*(.*)$/);
    if (!m) continue;
    const [, label, valueRaw] = m;
    let value = valueRaw.trim();
    const start = i;
    const field = LABELS.find(([re]) => re.test(label.trim()))?.[1];
    if (field) {
      // Value on the next line ("Address:\n1417 Golder Ave ...")
      if (!value && lines[i + 1] && !/:/.test(lines[i + 1])) value = lines[++i];
      // Address continued on the next line ("1417 Golder Ave\nOdessa, TX 79761")
      if (field === "address" && lines[i + 1] && !/:/.test(lines[i + 1]) &&
          new RegExp(`\\b(${STATE_PATTERN})\\b|\\b\\d{5}\\b`, "i").test(lines[i + 1]) &&
          !new RegExp(`\\b(${STATE_PATTERN})\\b|\\b\\d{5}\\b`, "i").test(value)) {
        value = `${value} ${lines[++i]}`;
      }
      if (value && !isBusiness(field, value)) (candidates[field] ??= []).push({ value, line: start });
    } else if (value && /\?$/.test(label) === false && label.length > 2) {
      // Other labeled answers ("Building type: Landscaping") are useful context.
      while (/^[a-z(]/.test(lines[i + 1] ?? "") && !/:/.test(lines[i + 1])) value += ` ${lines[++i]}`;
      notes.push(`${label.trim()}: ${value}`);
    }
  }

  // The prospect's details sit together; anchor on their name label (else the first
  // phone/email) and take the closest candidate for every field.
  const lineOf = (f: keyof typeof candidates) => candidates[f]?.[0]?.line;
  const anchor =
    lineOf("name") ?? lineOf("first") ??
    [lineOf("phone"), lineOf("email")].filter((n): n is number => n !== undefined).sort((x, y) => x - y)[0];
  const found: Partial<Record<keyof Lead | "first" | "last", string>> = {};
  for (const [field, list] of Object.entries(candidates) as [keyof typeof candidates, { value: string; line: number }[]][]) {
    const best = anchor === undefined
      ? list[0]
      // On a tie, prefer the value below the name: forms list the name first.
      : [...list].sort((x, y) =>
          Math.abs(x.line - anchor) - Math.abs(y.line - anchor) || Number(y.line > anchor) - Number(x.line > anchor),
        )[0];
    found[field] = best.value;
  }

  // Form questions often end in "?:" and wrap across lines; rejoin both halves.
  const startsLower = (l?: string) => !!l && /^[a-z(]/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const q = lines[i].match(/^(.{2,120}\?)\s*:?\s*(.+)$/);
    if (!q || !q[2].trim()) continue;
    let question = q[1];
    for (let j = i; startsLower(question) && j > 0 && !/[?:.!]$/.test(lines[j - 1]); j--) {
      question = `${lines[j - 1]} ${question}`;
    }
    let answer = q[2].trim();
    while (startsLower(lines[i + 1]) && !/:/.test(lines[i + 1])) answer += ` ${lines[++i]}`;
    notes.push(`${question.trim()} ${answer}`);
  }

  let name = found.name ?? [found.first, found.last].filter(Boolean).join(" ");
  let phone = found.phone ? formatPhone(found.phone.match(PHONE_RE)?.[0] ?? found.phone) : "";
  let email = found.email ? cleanEmail(found.email.match(EMAIL_RE)?.[0] ?? found.email) : "";

  if (!phone) {
    const line = lines.find((l) => !IGNORE_LINE.test(l) && PHONE_RE.test(l) && !isBusiness("phone", l));
    if (line) phone = formatPhone(line.match(PHONE_RE)![0]);
  }
  if (!email) {
    const m = lines.map((l) => l.match(EMAIL_RE)?.[0]).find((e) => e && !isBusiness("email", e));
    if (m) email = cleanEmail(m);
  }
  if (!name) {
    // CRM screenshots show the contact's name in the header or under "Opportunity Created".
    const idx = lines.findIndex((l) => /tap to view contact|opportunity created/i.test(l));
    const candidates = idx >= 0 ? [lines[idx - 1], lines[idx + 1]] : [];
    name = candidates.find((c) => c && /^[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3}$/.test(c.trim()))?.trim() ?? "";
  }

  const addr = found.address ? splitAddress(found.address) : { address: "", city: "", state: "", zip: "" };
  const city = found.city ?? addr.city;
  const stateRaw = found.state ?? addr.state;
  const state = STATES[stateRaw.toLowerCase()] ?? stateRaw;
  const zip = found.zip?.match(/\d{5}/)?.[0] ?? addr.zip;

  if (!name && !phone && !email && !addr.address) return null;
  return {
    name: name.replace(/\s+/g, " ").trim(),
    phone,
    email,
    address: addr.address,
    city: city.trim(),
    state: state.trim(),
    zip,
    notes: [...new Set(notes)].join(" | "),
  };
}
