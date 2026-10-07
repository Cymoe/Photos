import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";
import { STAGES } from "./pipeline";
import { fullAddress, groupPeople, type Person } from "./people";
import { AppointmentField } from "./appointments";
import { dayKey, formatAppointment, formatTime, useNow } from "./time";

type LeadRow = FunctionReturnType<typeof api.leads.list>[number];
type Booked = Person & { appointmentAt: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;

export function Calendar({ leads }: { leads?: LeadRow[] }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow();

  const people = useMemo(() => groupPeople(leads ?? []), [leads]);
  const booked = useMemo(
    () =>
      people
        .filter((p): p is Booked => p.appointmentAt !== undefined)
        .sort((a, b) => a.appointmentAt - b.appointmentAt),
    [people],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, Booked[]>();
    for (const p of booked) m.set(dayKey(p.appointmentAt), [...(m.get(dayKey(p.appointmentAt)) ?? []), p]);
    return m;
  }, [booked]);

  if (!leads) return <p className="muted">Loading…</p>;

  const today = dayKey(now);
  const upcoming = booked.filter((p) => p.appointmentAt >= now - 60 * 60 * 1000);
  // Appointment has passed but the lead never moved on: easy to lose track of.
  const followUp = booked.filter((p) => p.appointmentAt < now - 60 * 60 * 1000 && p.status === "scheduled");
  const current = people.find((p) => p.key === selected) as Booked | undefined;

  // Month grid: weeks starting Sunday, padded with the neighbouring months' days.
  const start = new Date(month);
  start.setDate(1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const weeks = days[35].getMonth() === month.getMonth() ? 6 : 5;
  const shiftMonth = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const groupedUpcoming = new Map<string, Booked[]>();
  for (const p of upcoming.slice(0, 40)) groupedUpcoming.set(dayKey(p.appointmentAt), [...(groupedUpcoming.get(dayKey(p.appointmentAt)) ?? []), p]);

  return (
    <section className="calendar-view">
      <div className="calendar-main">
        <div className="toolbar cal-nav">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
          <h2>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
          <button onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          <button
            onClick={() => {
              const d = new Date();
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
          >
            Today
          </button>
          <span className="spacer" />
          <span className="muted hint">Set appointments with 📅 on a Pipeline card.</span>
        </div>

        <div className="month">
          {WEEKDAYS.map((d) => (
            <div key={d} className="weekday">{d}</div>
          ))}
          {days.slice(0, weeks * 7).map((d) => {
            const key = dayKey(d.getTime());
            const appts = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                className={`day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${key === today ? "today" : ""}`}
              >
                <span className="num">{d.getDate()}</span>
                {appts.map((p) => (
                  <button
                    key={p.key}
                    className={`chip stage-${p.status} ${selected === p.key ? "active" : ""}`}
                    onClick={() => setSelected(p.key)}
                  >
                    <b>{formatTime(p.appointmentAt)}</b>
                    <span>{p.name || p.phone || "Lead"}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="agenda">
        {current && (
          <div className="appt-detail">
            <div className="row">
              <strong>{current.name || "Unknown name"}</strong>
              <button className="icon" title="Close" onClick={() => setSelected(null)}>×</button>
            </div>
            <span className="muted">{stageLabel(current.status)}</span>
            <AppointmentField person={current} />
            <div className="contact">
              {current.phone && <a href={`tel:${current.phone.replace(/[^\d+]/g, "")}`}>📞 {current.phone}</a>}
              {current.email && <a href={`mailto:${current.email}`}>✉️ {current.email}</a>}
              {fullAddress(current) && (
                <a href={`https://maps.apple.com/?q=${encodeURIComponent(fullAddress(current))}`} target="_blank" rel="noreferrer">
                  📍 {fullAddress(current)}
                </a>
              )}
            </div>
            {current.notes.length > 0 && (
              <ul className="project">{current.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            )}
            {current.myNotes && <p className="my-notes-view">{current.myNotes}</p>}
          </div>
        )}

        {followUp.length > 0 && (
          <>
            <h3 className="warn">Needs follow-up ({followUp.length})</h3>
            <p className="muted small">Appointment passed but still “Estimate Scheduled”.</p>
            {followUp.map((p) => (
              <AgendaItem key={p.key} p={p} onSelect={setSelected} selected={selected} showDate />
            ))}
          </>
        )}

        <h3>Upcoming ({upcoming.length})</h3>
        {upcoming.length === 0 && <p className="muted small">No upcoming appointments.</p>}
        {[...groupedUpcoming.entries()].map(([key, list]) => (
          <div key={key} className="agenda-day">
            <h4>
              {key === today
                ? "Today"
                : new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </h4>
            {list.map((p) => (
              <AgendaItem key={p.key} p={p} onSelect={setSelected} selected={selected} />
            ))}
          </div>
        ))}
      </aside>
    </section>
  );
}

function AgendaItem({
  p,
  onSelect,
  selected,
  showDate,
}: {
  p: Booked;
  onSelect: (key: string) => void;
  selected: string | null;
  showDate?: boolean;
}) {
  return (
    <button className={`agenda-item stage-${p.status} ${selected === p.key ? "active" : ""}`} onClick={() => onSelect(p.key)}>
      <span className="time">{showDate ? formatAppointment(p.appointmentAt) : formatTime(p.appointmentAt)}</span>
      <span className="who">{p.name || p.phone || "Lead"}</span>
      {fullAddress(p) && <span className="where">{p.city || fullAddress(p)}</span>}
    </button>
  );
}
