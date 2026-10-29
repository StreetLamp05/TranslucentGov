"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, mutate, setAdminSession } from "@/lib/data/api";

// The admin session both /admin pages share (server/admin.ts adminLogin): the passcode is swapped
// for a token that lasts 30 minutes, kept in memory only, and sent on every call by lib/data/api.ts.

/** What to show for a failed call: the server's message when it has one. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.data) return cause.data;
  return cause instanceof Error ? cause.message : String(cause);
}

export function useAdminSession() {
  const [signedIn, setSignedIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Don't leave the token behind when the page goes away.
  useEffect(() => () => setAdminSession(null), []);

  /** Throws the server's message for a wrong passcode. */
  const signIn = useCallback(async (passcode: string) => {
    const session = await mutate<{ token: string }>("/api/admin/login", { passcode });
    setAdminSession(session.token);
    setSignedIn(true);
    setNotice(null);
  }, []);

  const signOut = useCallback(() => {
    setAdminSession(null);
    setSignedIn(false);
  }, []);

  /**
   * The session slides on the server (each admin call extends it), so it ends only after 30 idle
   * minutes. Pass a failed call's error here: a 401 means it ended, and the page asks for the
   * passcode again.
   */
  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) {
      setAdminSession(null);
      setSignedIn(false);
      setNotice(cause.data ?? "Admin session expired. Sign in again.");
    }
  }, []);

  return { signedIn, notice, signIn, signOut, handleError };
}
