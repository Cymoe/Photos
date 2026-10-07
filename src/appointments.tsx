import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Person } from "./people";
import { toLocalInput, useNow } from "./time";

export function AppointmentField({ person }: { person: Person }) {
  const setAppointment = useMutation(api.leads.setAppointment);
  const now = useNow();
  const save = (value: string) => {
    const t = value ? new Date(value).getTime() : NaN;
    void setAppointment({ leadIds: person.ids, appointmentAt: Number.isNaN(t) ? null : t });
  };
  const upcoming = person.appointmentAt !== undefined && person.appointmentAt >= now;
  return (
    <div className={`appointment ${person.appointmentAt ? (upcoming ? "set" : "past") : ""}`}>
      <span aria-hidden>📅</span>
      <input
        type="datetime-local"
        aria-label="Appointment"
        value={person.appointmentAt ? toLocalInput(person.appointmentAt) : ""}
        onChange={(e) => save(e.target.value)}
      />
      {person.appointmentAt ? (
        <button className="icon" title="Clear appointment" onClick={() => save("")}>
          ×
        </button>
      ) : (
        <span className="muted">Set appointment</span>
      )}
    </div>
  );
}
