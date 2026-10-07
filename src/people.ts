import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { STAGES, byNewest, type Stage } from "./pipeline";

type LeadRow = FunctionReturnType<typeof api.leads.list>[number];

// One person can appear in several screenshots; they're merged into one Person.
export type Person = {
  key: string;
  ids: Id<"leads">[];
  rows: LeadRow[];
  date: string;
  status: Stage;
  myNotes: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string[];
  photoId: Id<"photos">;
  _creationTime: number;
};

// A full name (two+ words) is distinctive enough to match on; "John" alone is not.
const nameKey = (name: string) => {
  const n = name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  return n.split(" ").length >= 2 ? n : "";
};

// Leads are the same person if they share a phone number, an email, or a full name
// (transitively: A~B by phone and B~C by email puts A, B and C together).
export function groupPeople(leads: LeadRow[]): Person[] {
  const parent = leads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  leads.forEach((l, i) => {
    for (const k of [l.phoneKey && `p:${l.phoneKey}`, l.email && `e:${l.email.toLowerCase()}`, nameKey(l.name) && `n:${nameKey(l.name)}`]) {
      if (!k) continue;
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, LeadRow[]>();
  leads.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));

  return [...groups.values()].map((rows) => {
    rows.sort(byNewest);
    const first = (f: "name" | "phone" | "email") => rows.find((r) => r[f])?.[f] ?? "";
    const withAddr = rows.find((r) => r.address) ?? rows[0];
    // The most recently moved screenshot decides the stage.
    const latest = [...rows].sort((a, b) => (b.statusChangedAt ?? 0) - (a.statusChangedAt ?? 0))[0];
    return {
      key: rows.map((r) => r._id).sort()[0],
      ids: rows.map((r) => r._id),
      rows,
      date: rows.find((r) => r.date)?.date ?? "",
      status: (STAGES.some((s) => s.id === latest.status) ? latest.status : "new") as Stage,
      myNotes: [...new Set(rows.map((r) => r.myNotes).filter(Boolean))].join("\n"),
      name: first("name"),
      phone: first("phone"),
      email: first("email"),
      address: withAddr.address,
      city: withAddr.city,
      state: withAddr.state,
      zip: withAddr.zip,
      notes: [...new Set(rows.flatMap((r) => r.notes.split(" | ")).map((n) => n.trim()).filter(Boolean))],
      photoId: rows[0].photoId,
      _creationTime: rows[0]._creationTime,
    };
  });
}

export const fullAddress = (p: Person) => [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
