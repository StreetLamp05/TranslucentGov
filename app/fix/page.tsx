"use client";

import { useEffect, useState, type FormEvent } from "react";
import FixerList from "@/components/fix/FixerList";
import { ApiError, mutate, query } from "@/lib/data/api";
import { LIVE_LIST_MS, useLive } from "@/lib/data/useLive";
import { clearFixerToken, setFixerToken, useFixerToken } from "@/lib/hooks/useFixerToken";
import type { PublicReport } from "@/server/lib/publicReport";

// Hidden fixer route, no tab (§5.3.1): the passcode once (§3.1.2), then open reports nearest first.
export default function FixPage() {
  const token = useFixerToken();
  // The org, or null when the server no longer knows the token.
  const session = useLive(
    token ? `fixer-session:${token}` : null,
    (signal) => query<{ org: string } | null>("/api/fixers/session", {}, { signal }),
    { intervalMs: LIVE_LIST_MS },
  );

  // A token the server no longer knows (fixer re-seeded or removed) sends you back to the passcode.
  useEffect(() => {
    if (token && session === null) clearFixerToken();
  }, [token, session]);

  // Nothing renders while the stored token is read (hydration), and a loading line while
  // it's checked, so a signed-in fixer never sees the passcode screen flash.
  let content = null;
  if (token === undefined) content = null;
  else if (!token || session === null) content = <PasscodeForm />;
  else if (session) content = <FixerHome token={token} org={session.org} />;
  else content = <p className="py-12 text-center text-sm text-[#46505C]">Loading…</p>;

  return <main className="mx-auto min-h-dvh max-w-md p-4">{content}</main>;
}

function PasscodeForm() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await mutate<{ token: string; org: string }>("/api/fixers/login", { passcode });
      setFixerToken(token);
    } catch (err) {
      setError(err instanceof ApiError && err.data ? err.data : "Couldn't check the passcode. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-16 flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">Fixer sign-in</h1>
      <p className="text-sm text-[#46505C]">Enter your crew passcode. You only need to do this once on this phone.</p>
      <input
        type="password"
        autoComplete="current-password"
        aria-label="Passcode"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        className="rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-lg"
      />
      {error && (
        <p role="alert" className="text-sm font-semibold text-[#B42318]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !passcode.trim()}
        className="rounded-xl bg-[#0F1E33] py-3 font-bold text-white disabled:opacity-40"
      >
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

function FixerHome({ token, org }: { token: string; org: string }) {
  const reports = useLive(
    `fixer-open-reports:${token}`,
    (signal) => query<PublicReport[]>("/api/fixers/open-reports", {}, { signal }),
    { intervalMs: LIVE_LIST_MS },
  );
  return (
    <>
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">Open reports</h1>
          <p className="text-sm text-[#46505C]">{org}</p>
        </div>
        <button type="button" onClick={clearFixerToken} className="text-sm font-semibold text-[#46505C]">
          Sign out
        </button>
      </header>
      {reports === undefined ? (
        <p className="py-12 text-center text-sm text-[#46505C]">Loading…</p>
      ) : (
        <FixerList reports={reports} />
      )}
    </>
  );
}
