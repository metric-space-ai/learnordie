"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveCommand, LiveSessionView } from "./live-session";

/** One request in flight, bounded timeout, no overlapping interval backlog. */
export function useLiveSession(token: string, leaderboard: boolean, lecturer?: { id: string; csrfToken: string }) {
  const [state, setState] = useState<LiveSessionView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const stateRef = useRef<LiveSessionView | null>(null);
  const busyRef = useRef(false);
  const lastSuccess = useRef(0);
  const [serverOffset, setServerOffset] = useState(0);
  const lecturerId = lecturer?.id;
  const csrfToken = lecturer?.csrfToken;
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const accept = useCallback((incoming: LiveSessionView, requestStartedAt: number) => {
    const current = stateRef.current;
    if (current && (incoming.revision < current.revision || incoming.serverNow < current.serverNow)) return;
    stateRef.current = incoming;
    // serverNow is sampled AFTER request start. Using the start, not response
    // completion, is conservative: network/serialization delay can only close
    // a question early, never add time. Five-second request timeout bounds this.
    setServerOffset(incoming.serverNow - requestStartedAt);
    lastSuccess.current = Date.now();
    setState(incoming);
    setConnected(true);
    setConnectionError("");
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let abort: AbortController | undefined;
    async function poll() {
      const startedAt = Date.now();
      abort = new AbortController();
      const timeout = setTimeout(() => abort?.abort(), 5000);
      try {
        const response = await fetch(`/api/lecture/${encodeURIComponent(token)}/live${leaderboard ? "?leaderboard=1" : ""}`, { cache: "no-store", signal: abort.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Live-Verbindung unterbrochen.");
        }
        const incoming = await response.json() as LiveSessionView;
        if (!stopped) accept(incoming, startedAt);
      } catch (error) {
        if (!stopped) { setConnected(false); setConnectionError(error instanceof Error && error.name !== "AbortError" ? error.message : "Live-Verbindung unterbrochen."); }
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

  const send = useCallback(async (command: Omit<Extract<LiveCommand, { action: "slide" }>, "revision"> | Omit<Extract<LiveCommand, { action: "fire" }>, "revision"> | Omit<Extract<LiveCommand, { action: "publishDraft" }>, "revision"> | { action: "start" | "close" | "end" }) => {
    if (!lecturerId || !csrfToken || busyRef.current || !stateRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const startedAt = Date.now();
      const response = await fetch(`/api/lectures/${lecturerId}/live-session`, { method: "POST", headers: { "content-type": "application/json", "x-learnbuddy-csrf": csrfToken }, body: JSON.stringify({ ...command, revision: stateRef.current.revision }), signal: AbortSignal.timeout(6000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Live-Befehl nicht gespeichert.");
      accept(body as LiveSessionView, startedAt);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Live-Befehl nicht gespeichert.");
      refresh();
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [lecturerId, csrfToken, accept, refresh]);
  return { state, connected, error: error || connectionError, busy, send, refresh, serverOffset };
}
