"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { getOrCreateStudentKey, saveProfile } from "@/lib/student-client";
import { suggestionsWithoutRejected } from "@/lib/student-pseudonym";
import type { ResolvedJoinTarget } from "@/lib/types";
import { PseudonymChooser } from "./PseudonymChooser";

type JoinFlowProps = {
  code: string;
  target: ResolvedJoinTarget | null;
  hasProfile: boolean;
  hasClaim?: boolean;
  pseudonym?: string;
};

function redirectAfterJoin(target: ResolvedJoinTarget): string {
  if (target.scope === "lecture" && target.lectureToken) {
    if (target.lectureStatus === "live") return `/l/${encodeURIComponent(target.lectureToken)}`;
    if (target.lectureStatus === "learn_active" || target.lectureStatus === "archived") {
      return `/learn/${encodeURIComponent(target.lectureToken)}`;
    }
  }
  return `/student?series=${encodeURIComponent(target.seriesId)}`;
}

function useIslandFocus(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const focusable = () =>
      Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"));
    const first = focusable()[0];
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        window.location.href = "/";
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const start = items[0]!;
      const end = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
  return ref;
}

export function JoinFlow({ code, target, hasProfile: _hasProfile, hasClaim = false, pseudonym }: JoinFlowProps) {
  const router = useRouter();
  const [retryCode, setRetryCode] = useState("");
  const [pseudonymInput, setPseudonymInput] = useState(pseudonym ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [takenSuggestions, setTakenSuggestions] = useState<string[] | undefined>();
  const dialogRef = useIslandFocus(true);

  if (!target) {
    return (
      <main className="join-screen app-canvas lb-motion-root" aria-label="Code nicht gefunden">
        <section
          ref={dialogRef}
          className="join-card app-island lb-enter-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-unknown-title"
        >
          <p className="eyebrow">Code prüfen</p>
          <h1 id="join-unknown-title">Diesen Code kennen wir nicht</h1>
          <p className="join-lead">
            Der Code „{code}“ gehört zu keiner Vorlesung. Bitte prüfe die Schreibweise und versuche es erneut.
          </p>
          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              const next = retryCode.trim();
              if (next) router.push(`/join/${encodeURIComponent(next)}`);
            }}
          >
            <label>
              Code erneut eingeben
              <input
                value={retryCode}
                onChange={(event) => setRetryCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
              />
            </label>
            <button className="primary-button" type="submit">Erneut versuchen</button>
          </form>
          <Link className="join-back" href="/">Zur Startseite</Link>
        </section>
      </main>
    );
  }

  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/student/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCodeId: target!.joinCode.id, source: "code", displayName: pseudonymInput.trim() || undefined })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; suggestions?: string[] };
        setError(data.error ?? "Konnte nicht beitreten. Bitte erneut versuchen.");
        if (data.suggestions?.length) {
          setTakenSuggestions(suggestionsWithoutRejected(data.suggestions, pseudonymInput));
        }
        setBusy(false);
        return;
      }
      router.push(redirectAfterJoin(target!));
    } catch {
      setError("Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen.");
      setBusy(false);
    }
  }

  async function submitPseudonym(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = pseudonymInput.trim();
    if (clean.length < 2) {
      setError("Bitte ein Pseudonym wählen.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      getOrCreateStudentKey();
      const result = await saveProfile(clean);
      if (!result.ok) {
        setError(result.error);
        if (result.suggestions?.length) {
          setTakenSuggestions(suggestionsWithoutRejected(result.suggestions, clean));
        }
        setBusy(false);
        return;
      }
      await enroll();
    } catch {
      setError("Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen.");
      setBusy(false);
    }
  }

  const targetLabel = target.scope === "lecture" && target.lectureTitle ? target.lectureTitle : target.seriesTitle;

  return (
    <main className="join-screen app-canvas lb-motion-root" aria-label="Vorlesung beitreten">
      <section
        ref={dialogRef}
        className="join-card app-island lb-enter-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-title"
      >
        <p className="eyebrow">Vorlesung gefunden</p>
        <h1 id="join-title">{targetLabel}</h1>
        <p className="join-lead">
          {target.scope === "lecture"
            ? `Einzeltermin aus „${target.seriesTitle}".`
            : "Vorlesungsreihe — du siehst danach alle Termine in deinem Dashboard."}
        </p>

        {hasClaim ? (
          <>
            <p className="join-note">Angemeldet als <strong>{pseudonym}</strong>.</p>
            <p className="join-hint">Punkte hängen an diesem Browser. Der Anzeigename ist in dieser Vorlesung eindeutig.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="button" onClick={enroll} disabled={busy}>
              {busy ? "Wird hinzugefügt …" : "Zu meinen Vorlesungen hinzufügen"}
            </button>
          </>
        ) : (
          <form className="join-form" onSubmit={submitPseudonym}>
            <PseudonymChooser
              value={pseudonymInput}
              onChange={setPseudonymInput}
              disabled={busy}
              label="Wähle ein freies Pseudonym"
              seriesId={target.seriesId}
              suggestions={takenSuggestions}
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Trete bei …" : "Beitreten"}
            </button>
          </form>
        )}
        <Link className="join-back" href="/">Abbrechen</Link>
      </section>
    </main>
  );
}
