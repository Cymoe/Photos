import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";

import { STAGES, byNewest, type Stage } from "./pipeline";

type LeadRow = FunctionReturnType<typeof api.leads.list>[number];

// One card per person: screenshots of the same prospect are merged.
type Person = {
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
  notes: string[];
  photoId: Id<"photos">;
  _creationTime: number;
};

const personKey = (l: LeadRow) =>
  l.phoneKey || l.email.toLowerCase() || l.name.toLowerCase().replace(/\s+/g, " ").trim() || l._id;

function groupPeople(leads: LeadRow[]): Person[] {
  const groups = new Map<string, LeadRow[]>();
  for (const l of leads) groups.set(personKey(l), [...(groups.get(personKey(l)) ?? []), l]);
  return [...groups.entries()].map(([key, rows]) => {
    rows.sort(byNewest);
    const first = (f: "name" | "phone" | "email") => rows.find((r) => r[f])?.[f] ?? "";
    const withAddr = rows.find((r) => r.address);
    // The most recently moved screenshot decides the stage.
    const latest = [...rows].sort((a, b) => (b.statusChangedAt ?? 0) - (a.statusChangedAt ?? 0))[0];
    return {
      key,
      ids: rows.map((r) => r._id),
      rows,
      date: rows[0].date,
      status: (STAGES.some((s) => s.id === latest.status) ? latest.status : "new") as Stage,
      myNotes: rows.find((r) => r.myNotes)?.myNotes ?? "",
      name: first("name"),
      phone: first("phone"),
      email: first("email"),
      address: withAddr ? [withAddr.address, withAddr.city, withAddr.state, withAddr.zip].filter(Boolean).join(", ") : "",
      notes: [...new Set(rows.flatMap((r) => r.notes.split(" | ")).map((n) => n.trim()).filter(Boolean))],
      photoId: rows[0].photoId,
      _creationTime: rows[0]._creationTime,
    };
  });
}

function formatDate(date: string) {
  if (!date) return "No date";
  const d = new Date(`${date}T12:00:00`);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  const ago = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
  return `${label} · ${ago}`;
}

export function Board({
  leads,
  photoUrls,
  onPreview,
}: {
  leads?: LeadRow[];
  photoUrls: Map<string, string | null>;
  onPreview: (url: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [undatedOnly, setUndatedOnly] = useState(false);
  const setStatus = useMutation(api.leads.setStatus);
  const [drag, setDrag] = useState<{ person: Person; x: number; y: number; over: Stage | null } | null>(null);

  const people = useMemo(() => groupPeople(leads ?? []).sort(byNewest), [leads]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(
      (p) =>
        (!undatedOnly || !p.date) &&
        (!q || [p.name, p.phone, p.email, p.address, p.myNotes, ...p.notes].some((t) => t.toLowerCase().includes(q))),
    );
  }, [people, search, undatedOnly]);

  if (!leads) return <p className="muted">Loading…</p>;

  const newest = people.find((p) => p.date);
  const undated = people.filter((p) => !p.date).length;
  const move = (p: Person, status: Stage) => {
    if (p.status !== status) void setStatus({ leadIds: p.ids, status });
  };

  // Touch-friendly drag: the handle captures the pointer, and on release the card moves
  // to whichever column is under the finger.
  const stageAt = (x: number, y: number) =>
    ((document.elementFromPoint(x, y)?.closest("[data-stage]") as HTMLElement | null)?.dataset.stage as Stage) ?? null;
  const dragHandlers = (person: Person) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ person, x: e.clientX, y: e.clientY, over: person.status });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag) setDrag({ ...drag, x: e.clientX, y: e.clientY, over: stageAt(e.clientX, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const target = stageAt(e.clientX, e.clientY);
      if (drag && target) move(drag.person, target);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  return (
    <section>
      <div className="freshness">
        <span>
          <strong>{people.length}</strong> prospects · newest lead:{" "}
          <strong>{newest ? formatDate(newest.date) : "none dated yet"}</strong>
        </span>
        {undated > 0 && (
          <button className={`link ${undatedOnly ? "active" : ""}`} onClick={() => setUndatedOnly(!undatedOnly)}>
            {undatedOnly ? "Show all" : `${undated} with no date — review`}
          </button>
        )}
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search name, phone, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted hint">Drag a card by ⠿ or change its stage from the menu. Newest at the top.</span>
      </div>

      <div className="board">
        {STAGES.map((stage) => {
          const cards = shown.filter((p) => p.status === stage.id);
          return (
            <div
              key={stage.id}
              data-stage={stage.id}
              className={`column stage-${stage.id} ${drag?.over === stage.id ? "drop" : ""}`}
            >
              <h3>
                {stage.label} <span className="count">{cards.length}</span>
              </h3>
              {cards.map((p) => (
                <Card
                  key={p.key}
                  person={p}
                  dragging={drag?.person.key === p.key}
                  handle={dragHandlers(p)}
                  onMove={(s) => move(p, s)}
                  photoUrl={photoUrls.get(p.photoId) ?? null}
                  onPreview={onPreview}
                />
              ))}
              {cards.length === 0 && <p className="empty">Drop here</p>}
            </div>
          );
        })}
      </div>

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.person.name || drag.person.phone || "Lead"}
        </div>
      )}
    </section>
  );
}

function Card({
  person: p,
  dragging,
  handle,
  onMove,
  photoUrl,
  onPreview,
}: {
  person: Person;
  dragging: boolean;
  handle: React.HTMLAttributes<HTMLElement>;
  onMove: (s: Stage) => void;
  photoUrl: string | null;
  onPreview: (url: string) => void;
}) {
  const setMyNotes = useMutation(api.leads.setMyNotes);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <article className={`card ${dragging ? "dragging" : ""}`}>
      <header>
        <span className="drag-handle" title="Drag to another column" {...handle}>⠿</span>
        <div className="who">
          <strong>{p.name || "Unknown name"}</strong>
          <span className={`when ${p.date ? "" : "undated"}`}>{formatDate(p.date)}</span>
        </div>
      </header>

      <div className="contact">
        {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>📞 {p.phone}</a>}
        {p.email && <a href={`mailto:${p.email}`}>✉️ {p.email}</a>}
        {p.address && (
          <a href={`https://maps.apple.com/?q=${encodeURIComponent(p.address)}`} target="_blank" rel="noreferrer">
            📍 {p.address}
          </a>
        )}
      </div>

      {p.notes.length > 0 && (
        <ul className="project">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <textarea
        className="my-notes"
        placeholder="+ Add a note (called, left VM, estimate Tue 3pm…)"
        rows={(draft ?? p.myNotes) ? 3 : 2}
        value={draft ?? p.myNotes}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== p.myNotes) void setMyNotes({ leadIds: p.ids, myNotes: draft });
          setDraft(null);
        }}
      />

      <footer>
        <select value={p.status} onChange={(e) => onMove(e.target.value as Stage)}>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {photoUrl && (
          <button className="link" onClick={() => onPreview(photoUrl)}>
            screenshot{p.rows.length > 1 ? `s (${p.rows.length})` : ""}
          </button>
        )}
      </footer>
    </article>
  );
}
