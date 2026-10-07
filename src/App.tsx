import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc } from "../convex/_generated/dataModel";
import { resizeImage } from "./resize";
import { extractLeads } from "./extract";
import { downloadCsv } from "./csv";

const UPLOAD_CONCURRENCY = 4;
const FIELDS = ["name", "phone", "email", "address", "city", "state", "zip", "notes"] as const;
type Field = (typeof FIELDS)[number];
const LABELS: Record<Field, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  state: "State",
  zip: "Zip",
  notes: "Notes",
};

type UploadState = { total: number; done: number; failed: string[] };

export default function App() {
  const photos = useQuery(api.photos.list);
  const leads = useQuery(api.leads.list);
  const [tab, setTab] = useState<"leads" | "photos">("leads");
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const savePhoto = useMutation(api.photos.savePhoto);

  async function uploadFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name));
    if (!images.length) return;
    const state: UploadState = { total: images.length, done: 0, failed: [] };
    setUpload({ ...state });
    const queue = [...images];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          const blob = await resizeImage(file);
          const result = await extractLeads(blob);
          const url = await generateUploadUrl();
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          const { storageId } = await res.json();
          await savePhoto({ storageId, fileName: file.name, ...result });
        } catch (err) {
          state.failed.push(`${file.name}: ${err instanceof Error ? err.message : err}`);
        }
        state.done++;
        setUpload({ ...state, failed: [...state.failed] });
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
  }

  const counts = useMemo(() => {
    const c = { pending: 0, processing: 0, done: 0, error: 0 };
    for (const p of photos ?? []) c[p.status]++;
    return c;
  }, [photos]);

  return (
    <div className="app">
      <header>
        <h1>Photo Lead Extractor</h1>
        <div className="stats">
          <Stat label="Photos" value={photos?.length} />
          <Stat label="Queued" value={counts.pending + counts.processing} />
          <Stat label="Failed" value={counts.error} tone={counts.error ? "bad" : undefined} />
          <Stat label="Leads" value={leads?.length} tone="good" />
        </div>
      </header>

      <DropZone onFiles={uploadFiles} />
      {upload && (
        <div className="upload-status">
          <progress value={upload.done} max={upload.total} />
          <span>
            {upload.done < upload.total
              ? `Reading & uploading ${upload.done} / ${upload.total}. Keep this page open.`
              : `Done: ${upload.total} photo${upload.total === 1 ? "" : "s"} processed`}
          </span>
          {upload.done === upload.total && (
            <button className="link" onClick={() => setUpload(null)}>dismiss</button>
          )}
          {upload.failed.length > 0 && (
            <ul className="errors">{upload.failed.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
        </div>
      )}

      <nav className="tabs">
        <button className={tab === "leads" ? "active" : ""} onClick={() => setTab("leads")}>
          Leads ({leads?.length ?? 0})
        </button>
        <button className={tab === "photos" ? "active" : ""} onClick={() => setTab("photos")}>
          Photos ({photos?.length ?? 0})
        </button>
      </nav>

      {tab === "leads" ? (
        <LeadsTable leads={leads} photos={photos} onPreview={setPreview} />
      ) : (
        <PhotoGrid photos={photos} onPreview={setPreview} />
      )}

      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)}>
          <img src={preview} alt="" />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value?: number; tone?: "good" | "bad" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span className="value">{value ?? "–"}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? "over" : ""}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <strong>Drop photos here</strong> or click to choose. Select hundreds at once.
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

type LeadRow = FunctionReturnType<typeof api.leads.list>[number];
type PhotoRow = Doc<"photos"> & { url: string | null };

function LeadsTable({
  leads,
  photos,
  onPreview,
}: {
  leads?: LeadRow[];
  photos?: PhotoRow[];
  onPreview: (url: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [dupesOnly, setDupesOnly] = useState(false);
  const updateLead = useMutation(api.leads.update);
  const removeLead = useMutation(api.leads.remove);
  const photoUrls = useMemo(() => new Map((photos ?? []).map((p) => [p._id, p.url])), [photos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leads ?? []).filter(
      (l) =>
        (!dupesOnly || l.duplicate) &&
        (!q || FIELDS.some((f) => l[f].toLowerCase().includes(q)) || l.fileName.toLowerCase().includes(q)),
    );
  }, [leads, search, dupesOnly]);

  if (!leads) return <p className="muted">Loading…</p>;

  const exportAll = () => downloadCsv(filtered, "leads.csv");
  const exportUnique = () => {
    const seen = new Set<string>();
    downloadCsv(
      filtered.filter((l) => {
        if (!l.phoneKey) return true;
        if (seen.has(l.phoneKey)) return false;
        seen.add(l.phoneKey);
        return true;
      }),
      "leads-unique.csv",
    );
  };

  return (
    <section>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search leads…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          <input type="checkbox" checked={dupesOnly} onChange={(e) => setDupesOnly(e.target.checked)} />
          Duplicates only
        </label>
        <span className="spacer" />
        <button onClick={exportAll} disabled={!filtered.length}>Export CSV</button>
        <button onClick={exportUnique} disabled={!filtered.length}>Export (dedupe by phone)</button>
      </div>
      {leads.length === 0 ? (
        <p className="muted">No leads yet. Upload photos above and they'll appear here as they're processed.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {FIELDS.map((f) => <th key={f}>{LABELS[f]}</th>)}
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead._id} className={lead.duplicate ? "dupe" : ""}>
                  {FIELDS.map((f) => (
                    <td key={f} className={`col-${f}`}>
                      <EditableCell
                        value={lead[f]}
                        onSave={(value) => updateLead({ leadId: lead._id, field: f, value })}
                      />
                    </td>
                  ))}
                  <td className="source">
                    {photoUrls.get(lead.photoId) ? (
                      <button className="link" onClick={() => onPreview(photoUrls.get(lead.photoId)!)}>
                        {lead.fileName}
                      </button>
                    ) : (
                      lead.fileName
                    )}
                    {lead.duplicate && <span className="badge">dupe</span>}
                  </td>
                  <td>
                    <button
                      className="icon"
                      title="Delete lead"
                      onClick={() => confirm(`Delete ${lead.name || "this lead"}?`) && removeLead({ leadId: lead._id })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="cell"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onSave(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function PhotoGrid({ photos, onPreview }: { photos?: PhotoRow[]; onPreview: (url: string) => void }) {
  const saveResult = useMutation(api.photos.saveResult);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Re-read an already-uploaded photo (e.g. after the parser improves).
  async function reextract(p: PhotoRow) {
    if (!p.url) return;
    setBusy((b) => new Set(b).add(p._id));
    try {
      const blob = await (await fetch(p.url)).blob();
      await saveResult({ photoId: p._id, ...(await extractLeads(blob)) });
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(p._id);
        return next;
      });
    }
  }
  async function retryAllFailed() {
    for (const p of photos?.filter((p) => p.status === "error") ?? []) await reextract(p);
  }
  const remove = useMutation(api.photos.remove);
  if (!photos) return <p className="muted">Loading…</p>;
  const failed = photos.filter((p) => p.status === "error").length;

  return (
    <section>
      {failed > 0 && (
        <div className="toolbar">
          <button onClick={retryAllFailed} disabled={busy.size > 0}>
            {busy.size > 0 ? "Re-reading…" : `Retry ${failed} failed`}
          </button>
        </div>
      )}
      <div className="grid">
        {photos.map((p) => (
          <figure key={p._id} className={`photo ${p.status}`}>
            {p.url && <img src={p.url} alt={p.fileName} loading="lazy" onClick={() => onPreview(p.url!)} />}
            <figcaption>
              <span className="name" title={p.fileName}>{p.fileName}</span>
              <span className={`status ${p.status}`}>
                {p.status === "done" ? `${p.leadCount} lead${p.leadCount === 1 ? "" : "s"}` : p.status}
              </span>
              {p.error && <span className="error" title={p.error}>{p.error}</span>}
              <span className="actions">
                <button className="link" onClick={() => reextract(p)} disabled={busy.has(p._id)}>
                  {busy.has(p._id) ? "reading…" : "re-extract"}
                </button>
                <button
                  className="link"
                  onClick={() => confirm(`Delete ${p.fileName} and its leads?`) && remove({ photoId: p._id })}
                >
                  delete
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
