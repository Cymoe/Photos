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

export function parseLead(text: string): Lead | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[|]/g, "").trim())
    .filter(Boolean);

  const found: Partial<Record<keyof Lead | "first" | "last", string>> = {};
  const notes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z][A-Za-z\s-]{0,30}?)\s*[:;]\s*(.*)$/);
    if (!m) continue;
    const [, label, valueRaw] = m;
    let value = valueRaw.trim();
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
      if (value && !found[field]) found[field] = value;
    } else if (value && /\?$/.test(label) === false && label.length > 2) {
      // Other labeled answers ("Building type: Landscaping") are useful context.
      while (/^[a-z(]/.test(lines[i + 1] ?? "") && !/:/.test(lines[i + 1])) value += ` ${lines[++i]}`;
      notes.push(`${label.trim()}: ${value}`);
    }
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
    const line = lines.find((l) => !IGNORE_LINE.test(l) && PHONE_RE.test(l));
    if (line) phone = formatPhone(line.match(PHONE_RE)![0]);
  }
  if (!email) {
    const m = text.match(EMAIL_RE);
    if (m) email = cleanEmail(m[0]);
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
