"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export type PresenceState = "entering" | "open" | "exiting";

export function Presence({
  show,
  exitMs = 280,
  children
}: {
  show: boolean;
  exitMs?: number;
  children: (state: PresenceState) => ReactNode;
}) {
  const [present, setPresent] = useState(show);
  const [state, setState] = useState<PresenceState>(show ? "entering" : "exiting");

  useEffect(() => {
    if (show) {
      setPresent(true);
      setState("entering");
      const frame = window.requestAnimationFrame(() => setState("open"));
      return () => window.cancelAnimationFrame(frame);
    }

    if (!present) return;
    setState("exiting");
    const timeout = window.setTimeout(() => setPresent(false), exitMs);
    return () => window.clearTimeout(timeout);
  }, [exitMs, present, show]);

  if (!present) return null;

  return children(state);
}
