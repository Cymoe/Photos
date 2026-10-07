import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Person } from "./people";
import { formatAppointment, toLocalInput, useNow } from "./time";

// Tapping the button opens a small dialog with separate date and time fields. Nothing is
// saved until "Save": saving moves the card to another column, which would close an
// inline picker mid-selection on iPad.
export function AppointmentField({ person }: { person: Person }) {
  const setAppointment = useMutation(api.leads.setAppointment);
  const now = useNow();
  const [editing, setEditing] = useState<{ date: string; time: string } | null>(null);

  const open = () => {
    const local = toLocalInput(person.appointmentAt ?? now);
    setEditing({ date: local.slice(0, 10), time: person.appointmentAt ? local.slice(11, 16) : "09:00" });
  };
  const save = (appointmentAt: number | null) => {
    void setAppointment({ leadIds: person.ids, appointmentAt });
    setEditing(null);
  };
  const when = editing && editing.date && editing.time ? new Date(`${editing.date}T${editing.time}`).getTime() : NaN;
  const upcoming = person.appointmentAt !== undefined && person.appointmentAt >= now;

  return (
    <>
      <button
        type="button"
        className={`appointment ${person.appointmentAt ? (upcoming ? "set" : "past") : ""}`}
        onClick={open}
      >
        📅 {person.appointmentAt ? formatAppointment(person.appointmentAt) : "Set appointment"}
      </button>

      {editing &&
        createPortal(
        <div className="dialog-backdrop" onClick={() => setEditing(null)}>
          <div className="dialog" role="dialog" aria-label="Appointment" onClick={(e) => e.stopPropagation()}>
            <h3>Appointment · {person.name || person.phone || "Lead"}</h3>
            <label>
              Date
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </label>
            <label>
              Time
              <input type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} />
            </label>
            <div className="dialog-actions">
              {person.appointmentAt !== undefined && (
                <button type="button" className="danger" onClick={() => save(null)}>
                  Remove
                </button>
              )}
              <span className="spacer" />
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={Number.isNaN(when)} onClick={() => save(when)}>
                Save
              </button>
            </div>
          </div>
        </div>,
          // Rendered at page level so board/column styles don't leak into the dialog.
          document.body,
        )}
    </>
  );
}
