"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveCommand, LiveSessionView } from "./live-session";

/** One request in flight, bounded timeout, no overlapping interval backlog. */
export function useLiveSession(token: string, leaderboard: boolean, lecturer?: { id: string; csrfToken: string }) {
  const [state, setState] = useState<LiveSessionView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const stateRef = useRef<LiveSessionView | null>(null);
  const busyRef = useRef(false);
  const lastSuccess = useRef(0);
  const offset = useRef(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const accept = useCallback((incoming: LiveSessionView) => {
    const current = stateRef.current;
    if (current && (incoming.revision < current.revision || incoming.serverNow < current.serverNow)) return;
    stateRef.current = incoming;
    offset.current = incoming.serverNow - Date.now();
    lastSuccess.current = Date.now();
    setState(incoming);
    setConnected(true);
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let abort: AbortController | undefined;
    async function poll() {
      abort = new AbortController();
      const timeout = setTimeout(() => abort?.abort(), 5000);
      try {
        const response = await fetch(`/api/lecture/${encodeURIComponent(token)}/live${leaderboard ? "?leaderboard=1" : ""}`, { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error("Live-Verbindung unterbrochen.");
        const incoming = await response.json() as LiveSessionView;
        if (!stopped) accept(incoming);
      } catch {
        if (!stopped) setConnected(false);
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, document.hidden ? 4000 : 1500);
      }
    }
    void poll();
    const health = setInterval(() => { if (Date.now() - lastSuccess.current > 7000) setConnected(false); }, 1000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => { stopped = true; abort?.abort(); clearTimeout(timer); clearInterval(health); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", refresh); };
  }, [token, leaderboard, refreshKey, accept, refresh]);

  const send = useCallback(async (command: Omit<Extract<LiveCommand, { action: "slide" }>, "revision"> | Omit<Extract<LiveCommand, { action: "fire" }>, "revision"> | { action: "start" | "close" | "end" }) => {
    if (!lecturer || busyRef.current || !stateRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lectures/${lecturer.id}/live-session`, { method: "POST", headers: { "content-type": "application/json", "x-learnbuddy-csrf": lecturer.csrfToken }, body: JSON.stringify({ ...command, revision: stateRef.current.revision }), signal: AbortSignal.timeout(6000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Live-Befehl nicht gespeichert.");
      accept(body as LiveSessionView);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Live-Befehl nicht gespeichert.");
      refresh();
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [lecturer?.id, lecturer?.csrfToken, accept, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, connected, error, busy, send, refresh, serverOffset: offset.current };
}
