import { useEffect, useState } from "react";

// datetime-local inputs work in local time without a zone: "2026-10-09T15:00".
const pad = (n: number) => String(n).padStart(2, "0");
export const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const dayKey = (ms: number) => toLocalInput(ms).slice(0, 10);

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const formatAppointment = (ms: number) =>
  `${new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${formatTime(ms)}`;

// Current time, refreshed every minute so "upcoming" vs "past" stays correct on an open page.
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
