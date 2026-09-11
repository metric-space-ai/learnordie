"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import type { AgentThread, Lecture } from "@/lib/types";
import type { SlideDocument } from "@learnordie/slide-engine";

type StudioIntentComposerProps = {
  lectureId: string;
  csrfToken: string;
  slideId: string;
  blockId?: string;
  contextLabel: string;
  className?: string;
  autoFocus?: boolean;
  onDismiss?: () => void;
  onLecturesChange?: (lectures: Lecture[]) => void;
  onDocumentAccepted?: (document: SlideDocument, lecture: Lecture) => void;
  onPreviewDocumentChange?: (document: SlideDocument | null) => void;
};

export function StudioIntentComposer({
  lectureId,
  csrfToken,
  slideId,
  blockId,
  contextLabel,
  className = "",
  autoFocus = false,
  onDismiss,
  onLecturesChange,
  onDocumentAccepted,
  onPreviewDocumentChange
}: StudioIntentComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPrompt("");
    setThread(null);
    setMessage("");
    setError("");
    onPreviewDocumentChange?.(null);
  }, [blockId, lectureId, onPreviewDocumentChange, slideId]);

  async function proposeChange(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
    if (!normalizedPrompt || busy) return;

    setBusy(true);
    setError("");
    setMessage("");
    setThread(null);
    onPreviewDocumentChange?.(null);
    try {
      const response = await fetch(`/api/lectures/${lectureId}/agent-threads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-learnbuddy-csrf": csrfToken
        },
        body: JSON.stringify({
          mode: "studio_slide_edit",
          prompt: normalizedPrompt,
          slideId,
          blockId
        })
      });
      const payload = await response.json() as { error?: string; thread?: AgentThread; lectures?: Lecture[] };
      if (!response.ok || !payload.thread) {
        throw new Error(payload.error ?? "Die Änderung konnte nicht vorbereitet werden.");
      }
      setThread(payload.thread);
      if (payload.lectures) onLecturesChange?.(payload.lectures);
      onPreviewDocumentChange?.(payload.thread.reviewPatch?.previewDocument ?? null);
      setMessage("Vorschlag bereit.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Änderung konnte nicht vorbereitet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function decideChange(decision: "accept" | "reject") {
    if (!thread || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lectures/${lectureId}/agent-threads/${thread.id}/${decision}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-learnbuddy-csrf": csrfToken
        },
        body: JSON.stringify({})
      });
      const payload = await response.json() as { error?: string; lecture?: Lecture; lectures?: Lecture[] };
      if (!response.ok || !payload.lecture) {
        throw new Error(payload.error ?? "Die Entscheidung konnte nicht gespeichert werden.");
      }
      if (payload.lectures) onLecturesChange?.(payload.lectures);
      if (decision === "accept" && payload.lecture.slideDocument) {
        onDocumentAccepted?.(payload.lecture.slideDocument, payload.lecture);
      }
      onPreviewDocumentChange?.(null);
      setThread((current) => current ? { ...current, status: decision === "accept" ? "accepted" : "rejected" } : current);
      setPrompt("");
      setMessage(decision === "accept" ? "Änderung übernommen." : "Vorschlag verworfen.");
      if (decision === "reject") onDismiss?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Entscheidung konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
    if (event.key === "Escape") onDismiss?.();
  }

  const warnings = thread?.reviewPatch?.qa.warnings ?? [];
  const reviewPending = thread?.status === "awaiting_review";

  return (
    <form className={`studio-intent-composer ${className}`.trim()} onSubmit={proposeChange}>
      <div className="studio-intent-input-row">
        <span className="studio-intent-context">{contextLabel}</span>
        <textarea
          aria-label={`Änderungswunsch für ${contextLabel}`}
          autoFocus={autoFocus}
          disabled={busy || reviewPending}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Was soll sich ändern?"
          rows={1}
          value={prompt}
        />
        <button
          aria-label="Änderung vorschlagen"
          disabled={busy || reviewPending || !prompt.trim()}
          title="Änderung vorschlagen"
          type="submit"
        >
          ↑
        </button>
        {onDismiss ? (
          <button aria-label="Schließen" className="studio-intent-close" onClick={onDismiss} title="Schließen" type="button">×</button>
        ) : null}
      </div>

      {busy ? <p className="studio-intent-status" role="status">Änderung wird vorbereitet…</p> : null}
      {reviewPending ? (
        <div className="studio-intent-review" aria-live="polite">
          <span>{message}</span>
          <button type="button" onClick={() => void decideChange("reject")} disabled={busy}>Verwerfen</button>
          <button className="primary-button" type="button" onClick={() => void decideChange("accept")} disabled={busy}>Übernehmen</button>
        </div>
      ) : message ? <p className="studio-intent-status" aria-live="polite">{message}</p> : null}
      {warnings.length > 0 && reviewPending ? <p className="studio-intent-warning">Bitte prüfen: {warnings.join(" ")}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  );
}
