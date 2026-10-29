"use client";

import { useState, type FormEvent } from "react";
import { mutate, query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import { uploadAdminMedia } from "@/lib/adminUpload";
import { getResidentToken } from "@/lib/hooks/useResidentToken";
import { framesFromFile } from "@/lib/media/frames";
import { normalizeClip } from "@/lib/media/normalizeClip";
import { photoToJpeg } from "@/lib/media/photos";
import { errorMessage, useAdminSession } from "../useAdminSession";
import { PRESETS } from "./presets";

// Hidden seeding route (§6.1.1), no tab. Each sample is uploaded to MinIO here, then
// server/seed.ts runs it through the real screening (and the real fix check, if it has a fix
// clip). Signing in swaps the admin passcode for a 30-minute session held in memory only.

type Fixer = { id: string; name: string; org: string };
type Sample = {
  id: string;
  status: string;
  title: string | null;
  agency: string | null;
  verdict: string | null;
  reason: string | null;
  fix: { status: string; reason: string | null } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A clip being made postable (§4.1.1), started the moment it's picked, inside that tap, so iOS
// lets it keep its sound (see convertClip). Seed waits for it.
type Prepared = { clip: Promise<Blob>; controller: AbortController; status: string };

type Row = {
  key: number;
  files: File[]; // one video, or 1–10 photos
  preset: string; // an index into PRESETS, or "custom"
  lat: string;
  lng: string;
  description: string;
  daysOpen: string;
  daysSinceActivity: string;
  mine: boolean;
  fixFile: File | null;
  prepared: Prepared | null; // the sample's clip, when it's a video
  fixPrepared: Prepared | null;
  fixBy: string; // a fixer ID, or "resident" for a neighbor
  fixedDaysAgo: string;
};

let nextKey = 0;
function newRow(index: number): Row {
  const preset = String(index % PRESETS.length);
  const { lat, lng } = PRESETS[index % PRESETS.length];
  return {
    key: nextKey++,
    files: [],
    preset,
    lat: String(lat),
    lng: String(lng),
    description: "",
    daysOpen: "",
    daysSinceActivity: "",
    mine: false,
    fixFile: null,
    prepared: null,
    fixPrepared: null,
    fixBy: "",
    fixedDaysAgo: "",
  };
}

// "" means "now" (undefined); anything else is days before `now`.
function daysAgo(value: string, now: number, label: string): number | undefined {
  if (!value.trim()) return undefined;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) throw new Error(`${label} must be a number of days, 0 or more.`);
  return now - days * DAY_MS;
}

export default function SeedPage() {
  const session = useAdminSession();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await session.signIn(typed);
      setTyped("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  if (!session.signedIn) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-extrabold">Seed samples</h1>
        <form onSubmit={signIn} className="mt-4 flex gap-2">
          <input
            type="password"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Admin passcode"
            className="flex-1 rounded border px-3 py-2"
            autoComplete="off"
          />
          <button className="rounded bg-black px-4 py-2 font-semibold text-white">Sign in</button>
        </form>
        {(error ?? session.notice) && <p className="mt-3 text-sm text-red-700">{error ?? session.notice}</p>}
      </main>
    );
  }
  return <Seeder onFail={session.handleError} />;
}

function Seeder({ onFail }: { onFail: (cause: unknown) => void }) {
  const fixers = useLive<Fixer[]>("admin:fixers", (signal) => query("/api/admin/fixers", {}, { signal }));
  const samples = useLive<Sample[]>("admin:samples", (signal) => query("/api/admin/samples", {}, { signal }), {
    intervalMs: 5_000,
  });
  const [rows, setRows] = useState<Row[]>(() => [newRow(0)]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((all) => all.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  // Starts converting an iPhone .mov, a clip over 25 MB or one over 20 s (§4.1.1) right away, in
  // real time, replacing whatever that slot was preparing before. Fix clips lose their sound.
  function prepare(key: number, slot: "prepared" | "fixPrepared", file: File | null, previous: Prepared | null) {
    previous?.controller.abort();
    if (!file?.type.startsWith("video/")) return null;
    const controller = new AbortController();
    const setStatus = (status: string) =>
      setRows((all) =>
        all.map((row) => (row.key === key && row[slot]?.controller === controller ? { ...row, [slot]: { ...row[slot]!, status } } : row)),
      );
    const clip = normalizeClip(file, {
      onProgress: (p) => setStatus(`Converting… ${Math.round(p * 100)}%`),
      signal: controller.signal,
      audio: slot === "prepared",
    });
    clip.then(
      (out) => setStatus(out === file ? "" : "Converted"),
      (err: unknown) => (err as Error)?.name !== "AbortError" && setStatus("Couldn't convert this clip. Convert it with ffmpeg."),
    );
    return { clip, controller, status: "" };
  }

  async function uploadClip(prepared: Prepared) {
    const clip = await prepared.clip;
    const frames = await framesFromFile(clip);
    const [clipStorageId, frameStorageIds] = await Promise.all([uploadAdminMedia(clip), Promise.all(frames.map(uploadAdminMedia))]);
    return { clipStorageId, frameStorageIds };
  }

  async function seedAll() {
    setWorking(true);
    setError(null);
    try {
      const now = Date.now();
      const batch = [];
      for (const [i, row] of rows.entries()) {
        const label = `Sample ${i + 1}`;
        if (row.files.length === 0) throw new Error(`${label}: choose a clip or photos.`);
        const isVideo = row.files[0].type.startsWith("video/");
        if (isVideo ? row.files.length > 1 : row.files.some((f) => f.type.startsWith("video/"))) {
          throw new Error(`${label}: choose one clip, or photos only.`);
        }
        const [lat, lng] = [row.lat, row.lng].map((value) => (value.trim() ? Number(value) : NaN));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`${label}: enter a latitude and longitude.`);
        if (row.fixFile && !row.fixBy) throw new Error(`${label}: choose who filmed the fix.`);
        const createdAt = daysAgo(row.daysOpen, now, `${label}: opened`);
        const lastActivityAt = daysAgo(row.daysSinceActivity, now, `${label}: last activity`);
        const fixedAt = daysAgo(row.fixedDaysAgo, now, `${label}: fixed`);

        setProgress(`Uploading sample ${i + 1} of ${rows.length}…`);
        const media = isVideo
          ? { mediaType: "video" as const, ...(await uploadClip(row.prepared!)) }
          : {
              mediaType: "photos" as const,
              frameStorageIds: await Promise.all(row.files.map(async (photo) => uploadAdminMedia(await photoToJpeg(photo)))),
            };
        const fix = row.fixFile
          ? {
              ...(await uploadClip(row.fixPrepared!)),
              by: row.fixBy === "resident" ? { kind: "resident" as const } : { kind: "fixer" as const, fixerId: row.fixBy },
              fixedAt,
            }
          : undefined;
        batch.push({
          ...media,
          description: row.description.trim() || undefined,
          lat,
          lng,
          createdAt,
          lastActivityAt,
          residentToken: row.mine ? getResidentToken() : undefined,
          fix,
        });
      }
      setProgress("Seeding…");
      const ids = await mutate<string[]>("/api/admin/samples", { samples: batch });
      setProgress(`Seeded ${ids.length}. Screening runs 10 s apart; watch the table below.`);
      setRows([newRow(0)]);
    } catch (cause) {
      onFail(cause);
      setProgress(null);
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 text-sm">
      <h1 className="text-2xl font-extrabold">Seed samples</h1>
      <p className="mt-1 text-gray-600">
        Each sample is screened by the real pipeline and shows the &ldquo;Sample · filmed in California&rdquo; badge.
      </p>

      {rows.map((row, i) => (
        <fieldset key={row.key} className="mt-4 grid gap-2 rounded border p-3" disabled={working}>
          <legend className="px-1 font-bold">Sample {i + 1}</legend>
          <label>
            Clip or photos{" "}
            <input
              type="file"
              accept="video/*,image/*"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                const clip = files.length === 1 ? files[0] : null;
                update(row.key, { files, prepared: prepare(row.key, "prepared", clip, row.prepared) });
              }}
            />
            {row.prepared?.status && <span className="ml-2 text-gray-600">{row.prepared.status}</span>}
          </label>
          <label>
            Location{" "}
            <select
              value={row.preset}
              className="max-w-full rounded border px-2 py-1"
              onChange={(e) => {
                const preset = PRESETS[Number(e.target.value)];
                update(row.key, preset ? { preset: e.target.value, lat: String(preset.lat), lng: String(preset.lng) } : { preset: "custom" });
              }}
            >
              {PRESETS.map((p, index) => (
                <option key={p.label} value={index}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Type lat/lng</option>
            </select>
          </label>
          <div className="flex gap-2">
            <input
              aria-label="Latitude"
              value={row.lat}
              onChange={(e) => update(row.key, { lat: e.target.value, preset: "custom" })}
              className="w-32 rounded border px-2 py-1"
            />
            <input
              aria-label="Longitude"
              value={row.lng}
              onChange={(e) => update(row.key, { lng: e.target.value, preset: "custom" })}
              className="w-32 rounded border px-2 py-1"
            />
          </div>
          <input
            placeholder="Description (optional)"
            value={row.description}
            onChange={(e) => update(row.key, { description: e.target.value })}
            className="rounded border px-2 py-1"
          />
          <div className="flex flex-wrap gap-3">
            <label>
              Opened{" "}
              <input value={row.daysOpen} onChange={(e) => update(row.key, { daysOpen: e.target.value })} placeholder="0" className="w-14 rounded border px-2 py-1" />{" "}
              days ago
            </label>
            <label>
              Last activity{" "}
              <input
                value={row.daysSinceActivity}
                onChange={(e) => update(row.key, { daysSinceActivity: e.target.value })}
                placeholder="="
                className="w-14 rounded border px-2 py-1"
              />{" "}
              days ago
            </label>
            <label>
              <input type="checkbox" checked={row.mine} onChange={(e) => update(row.key, { mine: e.target.checked })} /> Posted by
              this device (Me page)
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t pt-2">
            <label>
              Fix clip (optional){" "}
              <input
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  update(row.key, { fixFile: file, fixPrepared: prepare(row.key, "fixPrepared", file, row.fixPrepared) });
                }}
              />
              {row.fixPrepared?.status && <span className="ml-2 text-gray-600">{row.fixPrepared.status}</span>}
            </label>
            <select value={row.fixBy} onChange={(e) => update(row.key, { fixBy: e.target.value })} className="rounded border px-2 py-1">
              <option value="">Filmed by…</option>
              {fixers?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.org} ({f.name})
                </option>
              ))}
              <option value="resident">A neighbor (not city-owned only)</option>
            </select>
            <label>
              Fixed{" "}
              <input
                value={row.fixedDaysAgo}
                onChange={(e) => update(row.key, { fixedDaysAgo: e.target.value })}
                placeholder="0"
                className="w-14 rounded border px-2 py-1"
              />{" "}
              days ago
            </label>
          </div>
          {rows.length > 1 && (
            <button type="button" className="justify-self-start text-red-700 underline" onClick={() => {
              row.prepared?.controller.abort();
              row.fixPrepared?.controller.abort();
              setRows((all) => all.filter((r) => r.key !== row.key));
            }}>
              Remove
            </button>
          )}
        </fieldset>
      ))}

      <div className="mt-4 flex gap-2">
        <button type="button" disabled={working} className="rounded border px-4 py-2" onClick={() => setRows((all) => [...all, newRow(all.length)])}>
          Add sample
        </button>
        <button type="button" disabled={working} className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={seedAll}>
          Seed {rows.length}
        </button>
      </div>
      {progress && <p className="mt-3">{progress}</p>}
      {error && <p className="mt-3 text-red-700">{error}</p>}

      <h2 className="mt-8 text-lg font-bold">Samples</h2>
      <table className="mt-2 w-full text-left text-xs">
        <thead>
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Title</th>
            <th>Fix</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {samples?.map((s) => (
            <tr key={s.id} className="border-t align-top">
              <td className="pr-2 font-mono">{s.id}</td>
              <td className="pr-2">
                {s.status}
                {s.status === "held" ? ` (${s.verdict ?? "failed"}: ${s.reason ?? ""})` : ""}
              </td>
              <td className="pr-2">
                {s.title ?? "…"}
                {s.agency ? ` · ${s.agency}` : ""}
              </td>
              <td className="pr-2">{s.fix ? `${s.fix.status}${s.fix.reason ? `: ${s.fix.reason}` : ""}` : ""}</td>
              <td>
                <OperatorButtons sample={s} onError={setError} onFail={onFail} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ReportTools onFail={onFail} />
      <FixersForm onFail={onFail} />
    </main>
  );
}

// Rescreen / release (§4.2.1) for a sample that's held or stuck on pending.
function OperatorButtons({
  sample,
  onError,
  onFail,
}: {
  sample: Sample;
  onError: (message: string | null) => void;
  onFail: (cause: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (sample.status !== "held" && sample.status !== "pending") return null;

  async function run(path: string, body: object) {
    setBusy(true);
    onError(null);
    try {
      await mutate(path, { reportId: sample.id, ...body });
    } catch (cause) {
      onFail(cause);
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  // A held verdict (retake, reject, emergency) needs the operator to confirm the release.
  const forced = sample.status === "held" && !!sample.verdict && sample.verdict !== "pass" && sample.verdict !== "mute";
  return (
    <span className="flex gap-2">
      <button type="button" disabled={busy} className="underline" onClick={() => run("/api/admin/rescreen", {})}>
        Rescreen
      </button>
      {sample.status === "held" && (
        <button
          type="button"
          disabled={busy}
          className="underline"
          onClick={() => {
            if (!forced || window.confirm(`Held as ${sample.verdict}. Release it anyway?`)) void run("/api/admin/release", { force: forced });
          }}
        >
          Release
        </button>
      )}
    </span>
  );
}

// Rescreen / release (§4.2.1) for any report by ID, such as a live post stuck on "Checking…".
function ReportTools({ onFail }: { onFail: (cause: unknown) => void }) {
  const [reportId, setReportId] = useState("");
  const [force, setForce] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "rescreen" | "release") {
    setMessage(null);
    setError(null);
    try {
      await mutate(`/api/admin/${action}`, { reportId: reportId.trim(), force });
      setMessage(action === "rescreen" ? "Screening again." : "Released.");
    } catch (cause) {
      onFail(cause);
      setError(errorMessage(cause));
    }
  }

  return (
    <section className="mt-8 grid gap-2">
      <h2 className="text-lg font-bold">Report tools</h2>
      <input
        aria-label="Report ID"
        placeholder="Report ID"
        value={reportId}
        onChange={(e) => setReportId(e.target.value)}
        className="rounded border px-2 py-1 font-mono"
        autoComplete="off"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!reportId.trim()} className="rounded border px-4 py-2 disabled:opacity-50" onClick={() => run("rescreen")}>
          Rescreen
        </button>
        <button type="button" disabled={!reportId.trim()} className="rounded border px-4 py-2 disabled:opacity-50" onClick={() => run("release")}>
          Release
        </button>
        <label>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> force (retake, emergency or reject)
        </label>
      </div>
      {message && <p>{message}</p>}
      {error && <p className="text-red-700">{error}</p>}
    </section>
  );
}

// Fixers for the "Filmed by…" picker (§3.1.2). One per
// line as `name | org | passcode`; running it again updates a fixer by passcode.
function FixersForm({ onFail }: { onFail: (cause: unknown) => void }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const fixers = text
        .split("\n")
        .filter((line) => line.trim())
        .map((line, i) => {
          const [name, org, passcode, ...extra] = line.split("|").map((part) => part.trim());
          if (!name || !org || !passcode || extra.length) throw new Error(`Line ${i + 1}: write it as name | org | passcode.`);
          return { name, org, passcode };
        });
      const { inserted, updated } = await mutate<{ inserted: number; updated: number }>("/api/admin/fixers", { fixers });
      setMessage(`Added ${inserted}, updated ${updated}.`);
      setText("");
    } catch (cause) {
      onFail(cause);
      setError(errorMessage(cause));
    }
  }

  return (
    <form onSubmit={save} className="mt-8 grid gap-2">
      <h2 className="text-lg font-bold">Fixers</h2>
      <p className="text-gray-600">One per line: name | org | passcode. The org is what a fixed card shows (&ldquo;Fixed by SF Public Works&rdquo;).</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Demo crew | SF Public Works | passcode"
        className="rounded border px-2 py-1 font-mono"
        autoComplete="off"
      />
      <button className="justify-self-start rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={!text.trim()}>
        Save fixers
      </button>
      {message && <p>{message}</p>}
      {error && <p className="text-red-700">{error}</p>}
    </form>
  );
}
