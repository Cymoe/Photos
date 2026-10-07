// Pipeline stages, in board order. Ids match STATUSES in convex/leads.ts.
export const STAGES = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "scheduled", label: "Estimate Scheduled" },
  { id: "sent", label: "Estimate Sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
] as const;
export type Stage = (typeof STAGES)[number]["id"];

// Newest first; undated last. Dates are YYYY-MM-DD so they compare as strings.
export const byNewest = (a: { date: string; _creationTime?: number }, b: { date: string; _creationTime?: number }) =>
  !a.date || !b.date
    ? Number(!a.date) - Number(!b.date) || (b._creationTime ?? 0) - (a._creationTime ?? 0)
    : b.date.localeCompare(a.date) || (b._creationTime ?? 0) - (a._creationTime ?? 0);

