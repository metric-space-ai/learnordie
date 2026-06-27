"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { getOrCreateStudentKey, saveProfile } from "@/lib/student-client";
import { suggestPseudonyms } from "@/lib/student-pseudonym";
import type { ResolvedJoinTarget } from "@/lib/types";
import { PseudonymChooser } from "./PseudonymChooser";

type JoinFlowProps = {
  code: string;
  target: ResolvedJoinTarget | null;
  hasProfile: boolean;
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

export function JoinFlow({ code, target, hasProfile, pseudonym }: JoinFlowProps) {
  const router = useRouter();
  const [retryCode, setRetryCode] = useState("");
  const [pseudonymInput, setPseudonymInput] = useState(() => pseudonym ?? suggestPseudonyms(code)[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!target) {
    return (
      <main className="join-screen lb-motion-root" aria-label="Code nicht gefunden">
        <section className="join-card lb-enter-panel">
          <p className="eyebrow">Code prüfen</p>
          <h1>Diesen Code kennen wir nicht</h1>
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
                placeholder="z. B. ME1-GL-2026"
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
        body: JSON.stringify({ joinCodeId: target!.joinCode.id, source: "code" })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Konnte nicht beitreten. Bitte erneut versuchen.");
        setBusy(false);
        return;
      }
      router.push(redirectAfterJoin(target!));
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
      setBusy(false);
    }
  }

  async function submitPseudonym(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = pseudonymInput.trim();
    if (clean.length < 1) {
      setError("Bitte ein Pseudonym wählen.");
      return;
    }
    setBusy(true);
    setError("");
    getOrCreateStudentKey();
    const profile = await saveProfile(clean);
    if (!profile) {
      setError("Profil konnte nicht gespeichert werden.");
      setBusy(false);
      return;
    }
    await enroll();
  }

  const targetLabel = target.scope === "lecture" && target.lectureTitle ? target.lectureTitle : target.seriesTitle;

  return (
    <main className="join-screen lb-motion-root" aria-label="Vorlesung beitreten">
      <section className="join-card lb-enter-panel">
        <p className="eyebrow">Vorlesung gefunden</p>
        <h1>{targetLabel}</h1>
        <p className="join-lead">
          {target.scope === "lecture"
            ? `Einzeltermin aus „${target.seriesTitle}".`
            : "Vorlesungsreihe — du siehst danach alle Termine in deinem Dashboard."}
        </p>

        {hasProfile ? (
          <>
            <p className="join-note">Angemeldet als <strong>{pseudonym}</strong>.</p>
            <p className="join-hint">Deine Punkte sind an deinen anonymen Browser-Schlüssel gebunden, nicht nur an den Anzeigenamen.</p>
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
              seed={code}
              disabled={busy}
              label="Wähle ein Pseudonym"
            />
            <p className="join-hint">
              Punkte und Dashboard-Zugriff hängen an diesem Browser-Schlüssel. Jemand mit gleichem Pseudonym übernimmt deine Punkte nicht.
            </p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Trete bei …" : "Pseudonym wählen und beitreten"}
            </button>
          </form>
        )}
        <Link className="join-back" href="/">Abbrechen</Link>
      </section>
    </main>
  );
}
