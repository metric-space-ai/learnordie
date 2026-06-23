"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import type { JoinCode } from "@/lib/types";

const CSRF_HEADER = "x-learnbuddy-csrf";

type ShareInfo = {
  seriesId: string;
  seriesTitle: string;
  joinCode?: string;
  joinPath?: string;
  enabled: boolean;
};

export function JoinCodeEditor({
  seriesId,
  seriesTitle,
  csrfToken
}: {
  seriesId: string;
  seriesTitle: string;
  csrfToken: string;
}) {
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadShare = useCallback(async () => {
    try {
      const response = await fetch(`/api/lecturer/series/${encodeURIComponent(seriesId)}/share`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { share: ShareInfo | null };
      if (data.share) setShare(data.share);
    } catch {
      // ignore — editor stays in "set a code" state
    }
  }, [seriesId]);

  useEffect(() => {
    void loadShare();
  }, [loadShare]);

  async function saveCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = codeInput.trim();
    if (!code) {
      setError("Bitte einen Code eingeben.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lecturer/series/${encodeURIComponent(seriesId)}/join-code`, {
        method: "PATCH",
        headers: { "content-type": "application/json", [CSRF_HEADER]: csrfToken },
        body: JSON.stringify({ code })
      });
      const data = (await response.json().catch(() => ({}))) as { share?: ShareInfo; joinCode?: JoinCode; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Code konnte nicht gespeichert werden.");
        setBusy(false);
        return;
      }
      if (data.share) setShare(data.share);
      setCodeInput("");
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    }
    setBusy(false);
  }

  async function disableCode() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lecturer/series/${encodeURIComponent(seriesId)}/join-code`, {
        method: "DELETE",
        headers: { [CSRF_HEADER]: csrfToken }
      });
      const data = (await response.json().catch(() => ({}))) as { share?: ShareInfo; error?: string };
      if (response.ok) setShare(data.share ?? { seriesId, seriesTitle, enabled: false });
    } catch {
      setError("Code konnte nicht deaktiviert werden.");
    }
    setBusy(false);
  }

  async function copyLink() {
    if (!share?.joinPath) return;
    const url = `${window.location.origin}${share.joinPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Kopieren nicht möglich.");
    }
  }

  return (
    <section className="join-code-editor" aria-label="Vorlesungscode teilen">
      {share?.joinCode ? (
        <div className="join-code-active">
          <p className="join-code-label">Aktiver Code für Studierende</p>
          <p className="join-code-value">{share.joinCode}</p>
          <div className="join-code-actions">
            <button type="button" className="plain-button small" onClick={copyLink}>
              {copied ? "Link kopiert ✓" : "Link kopieren"}
            </button>
            <button type="button" className="plain-button small" onClick={disableCode} disabled={busy}>
              Deaktivieren
            </button>
          </div>
          {share.joinPath && <p className="join-code-link">{`${typeof window !== "undefined" ? window.location.origin : ""}${share.joinPath}`}</p>}
        </div>
      ) : (
        <p className="join-code-empty">Noch kein Code gesetzt — Studierende brauchen einen Code zum Beitreten.</p>
      )}

      <form className="join-code-form" onSubmit={saveCode}>
        <label>
          {share?.joinCode ? "Code ändern" : "Code festlegen"}
          <input
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value)}
            placeholder="z. B. ME1-GL-2026"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="studio-command-primary" disabled={busy}>
          {busy ? "Speichern …" : "Code speichern"}
        </button>
      </form>
    </section>
  );
}
