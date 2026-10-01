const COLUMNS = ["name", "phone", "email", "address", "city", "state", "zip", "notes", "fileName"] as const;
const HEADERS = ["Name", "Phone", "Email", "Address", "City", "State", "Zip", "Notes", "Source Photo"];

type Row = Record<(typeof COLUMNS)[number], string>;

const escape = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function downloadCsv(rows: Row[], filename: string) {
  const lines = [HEADERS.join(","), ...rows.map((r) => COLUMNS.map((c) => escape(r[c] ?? "")).join(","))];
  // BOM so Excel opens UTF-8 names correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
