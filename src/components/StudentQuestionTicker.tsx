"use client";

import { useCallback, useEffect, useState } from "react";
import type { QuestionVariant, StudentChatQuestionStatus, StudentExamDraftStatus } from "@/lib/types";

type TickerQuestion = {
  id: string;
  text: string;
  pseudonym: string;
  status: StudentChatQuestionStatus;
  createdAt: string;
  examDraftStatus: StudentExamDraftStatus;
  examDraftError?: string;
  draft: null | {
    id: string;
    status: "draft" | "approved";
    topic: string;
    coreStatement: string;
    variants: QuestionVariant[];
  };
};

export function StudentQuestionTicker({ lectureId, csrfToken, canPublish, onPublishDraft }: {
  lectureId: string;
  csrfToken: string;
  canPublish: boolean;
  onPublishDraft: (questionId: string) => Promise<boolean>;
}) {
  const [questions, setQuestions] = useState<TickerQuestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/student-question-ticker`, {
      cache: "no-store",
      signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Fragen konnten nicht geladen werden.");
    setQuestions(Array.isArray(body.questions) ? body.questions as TickerQuestion[] : []);
  }, [lectureId]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | undefined;
    const poll = async () => {
      active = new AbortController();
      try {
        await refresh(active.signal);
        if (!stopped) setError("");
      } catch (caught) {
        if (!stopped && !(caught instanceof Error && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "Fragen konnten nicht geladen werden.");
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, document.hidden ? 10_000 : 4_000);
      }
    };
    const onVisibility = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      active?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function runAction(action: "retry" | "reject", questionId: string) {
    setBusyId(questionId);
    setError("");
    try {
      const response = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/student-question-ticker`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-learnbuddy-csrf": csrfToken },
        body: JSON.stringify({ action, questionId })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Änderung konnte nicht gespeichert werden.");
      if (Array.isArray(body.questions)) setQuestions(body.questions as TickerQuestion[]);
      else await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
      await refresh().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function publish(questionId: string) {
    setBusyId(questionId);
    setError("");
    try {
      const published = await onPublishDraft(questionId);
      if (!published) throw new Error("Die Fragerunde wurde nicht gestartet.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Fragerunde wurde nicht gestartet.");
      await refresh().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = questions.filter((question) => question.examDraftStatus !== "published" && question.examDraftStatus !== "rejected").length;
  return <aside aria-label="Eingehende Studierendenfragen" className="student-question-ticker" style={{
    position: "fixed", right: 16, top: 16, zIndex: 40, width: open ? "min(360px, calc(100vw - 32px))" : "auto",
    color: "#f8fafc", font: "500 13px/1.4 system-ui, sans-serif", pointerEvents: "auto"
  }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{
      display: "block", marginLeft: "auto", border: "1px solid rgba(255,255,255,.18)", borderRadius: 999,
      padding: "8px 12px", background: "rgba(15,23,42,.94)", color: "inherit", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,.22)"
    }}>
      Fragen{pendingCount ? ` · ${pendingCount}` : ""}
    </button>
    {open && <section aria-label="Fragen und Entwürfe" style={{ marginTop: 8, maxHeight: "min(62vh, 520px)", overflow: "auto", border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, padding: 12, background: "rgba(15,23,42,.97)", boxShadow: "0 10px 30px rgba(0,0,0,.26)" }}>
      {error && <p role="status" style={{ margin: "0 0 8px", color: "#fca5a5" }}>{error}</p>}
      {questions.length === 0 && <p style={{ margin: 0, color: "#cbd5e1" }}>Noch keine Fragen.</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {questions.map((question) => <article key={question.id} style={{ borderTop: "1px solid rgba(255,255,255,.12)", paddingTop: 9 }}>
          <p style={{ margin: "0 0 4px", color: "#cbd5e1", fontSize: 11 }}>{question.pseudonym} · {new Date(question.createdAt).toLocaleTimeString()}</p>
          <p style={{ margin: "0 0 7px", overflowWrap: "anywhere" }}>{question.text}</p>
          {question.draft ? <details>
            <summary style={{ cursor: "pointer", color: "#bfdbfe" }}>Entwurf prüfen · {question.draft.topic}</summary>
            <p style={{ margin: "7px 0", color: "#cbd5e1" }}>{question.draft.coreStatement}</p>
            {question.draft.variants.map((variant) => <div key={variant.level} style={{ margin: "8px 0", padding: 8, borderRadius: 8, background: "rgba(255,255,255,.06)" }}>
              <strong>{variant.level}</strong>
              <p style={{ margin: "4px 0" }}>{variant.text}</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {variant.answers.map((answer) => <li key={answer.key} style={{ color: answer.correct ? "#86efac" : "#e2e8f0" }}>{answer.key}. {answer.text}{answer.correct ? " · richtig" : ""}</li>)}
              </ul>
              <p style={{ margin: "5px 0 0", color: "#cbd5e1" }}>{variant.explanation}</p>
            </div>)}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" disabled={!canPublish || busyId === question.id} onClick={() => void publish(question.id)}>{busyId === question.id ? "Wird gespeichert …" : "Explizit live stellen · 60 s"}</button>
              <button type="button" disabled={busyId === question.id} onClick={() => void runAction("reject", question.id)}>Ablehnen</button>
            </div>
          </details> : question.examDraftStatus === "generating" || question.examDraftStatus === "pending" ? <p role="status" style={{ margin: 0, color: "#cbd5e1" }}>Entwurf wird vorbereitet …</p>
            : question.examDraftStatus === "failed" || question.examDraftStatus === "unsupported" ? <div>
              <p style={{ margin: "0 0 6px", color: "#fcd34d" }}>{question.examDraftError ?? "Kein Entwurf verfügbar."}</p>
              <button type="button" disabled={busyId === question.id} onClick={() => void runAction("retry", question.id)}>Erneut versuchen</button>
            </div>
              : <p style={{ margin: 0, color: "#cbd5e1" }}>{question.examDraftStatus === "published" ? "Veröffentlicht" : question.examDraftStatus === "rejected" ? "Abgelehnt" : "Nicht zur Entwurfserstellung übernommen"}</p>}
        </article>)}
      </div>
      {!canPublish && <p style={{ margin: "10px 0 0", color: "#cbd5e1", fontSize: 11 }}>Veröffentlichen ist verfügbar, wenn die Präsentation läuft und keine andere Fragerunde offen ist.</p>}
    </section>}
  </aside>;
}
