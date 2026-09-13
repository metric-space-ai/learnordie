"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionVariant, StudentChatQuestionStatus, StudentExamDraftStatus } from "@/lib/types";

export type TickerQuestion = {
  id: string;
  text: string;
  pseudonym: string;
  status: StudentChatQuestionStatus;
  createdAt: string;
  attemptAt: string | null;
  examDraftStatus: StudentExamDraftStatus;
  generationStale: boolean;
  examDraftError?: string;
  draft: null | {
    id: string;
    status: "draft" | "approved";
    topic: string;
    coreStatement: string;
    variants: QuestionVariant[];
  };
};

export function StudentQuestionTickerItem({ question, canPublish, busyId, onPublish, onRetry, onReject }: {
  question: TickerQuestion;
  canPublish: boolean;
  busyId: string | null;
  onPublish: () => void;
  onRetry: () => void;
  onReject: () => void;
}) {
  return <article className="student-question-ticker__item">
    <p className="student-question-ticker__meta">{question.pseudonym} · {new Date(question.createdAt).toLocaleTimeString()}</p>
    <p className="student-question-ticker__question">{question.text}</p>
    {question.draft ? <details>
      <summary className="student-question-ticker__draft-summary">Entwurf prüfen · {question.draft.topic}</summary>
      <p className="student-question-ticker__core">{question.draft.coreStatement}</p>
      {question.draft.variants.map((variant) => <div key={variant.level} className="student-question-ticker__variant">
        <strong>{variant.level}</strong>
        <p className="student-question-ticker__variant-text">{variant.text}</p>
        <ul className="student-question-ticker__answers">
          {variant.answers.map((answer) => <li key={answer.key} data-correct={answer.correct}>{answer.key}. {answer.text}{answer.correct ? " · richtig" : ""}</li>)}
        </ul>
        <p className="student-question-ticker__explanation">{variant.explanation}</p>
      </div>)}
      <div className="student-question-ticker__actions">
        {question.examDraftStatus !== "published" && <button type="button" disabled={!canPublish || busyId !== null} onClick={onPublish}>{busyId === question.id ? "Wird gespeichert …" : "Live stellen · 60 s"}</button>}
        {question.examDraftStatus !== "published" && <button type="button" disabled={busyId !== null} onClick={onReject}>Ablehnen</button>}
      </div>
    </details> : question.examDraftStatus === "generating" && question.generationStale ? <div>
      <p role="status" className="student-question-ticker__status">Die Entwurfserstellung hängt möglicherweise fest.</p>
      <button type="button" disabled={busyId !== null} onClick={onRetry}>{busyId === question.id ? "Wird neu gestartet …" : "Erstellung neu starten"}</button>
      <button type="button" disabled={busyId !== null} onClick={onReject}>Entwurf ablehnen</button>
    </div> : question.examDraftStatus === "generating" ? <p role="status" className="student-question-ticker__status">Entwurf wird vorbereitet …</p>
      : question.examDraftStatus === "pending" ? <div>
        <p className="student-question-ticker__status">Entwurf wartet auf Erstellung.</p>
        <button type="button" disabled={busyId !== null} onClick={onRetry}>Entwurf erstellen</button>
      </div>
        : question.examDraftStatus === "failed" || question.examDraftStatus === "unsupported" ? <div>
        <p className="student-question-ticker__status">{question.examDraftError ?? "Kein Entwurf verfügbar."}</p>
        <button type="button" disabled={busyId !== null} onClick={onRetry}>Erneut versuchen</button>
      </div>
          : <p className="student-question-ticker__status">{question.examDraftStatus === "published" ? "Veröffentlicht" : question.examDraftStatus === "rejected" ? "Abgelehnt" : "Nicht zur Entwurfserstellung übernommen"}</p>}
  </article>;
}

export function StudentQuestionTicker({ lectureId, csrfToken, canPublish, onPublishDraft, placement = "top-left", className }: {
  lectureId: string;
  csrfToken: string;
  canPublish: boolean;
  onPublishDraft: (questionId: string) => Promise<boolean>;
  placement?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "host";
  className?: string;
}) {
  const [questions, setQuestions] = useState<TickerQuestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const polling = useRef(false);
  const mutating = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await boundedFetch(`/api/lectures/${encodeURIComponent(lectureId)}/student-question-ticker`, {
      cache: "no-store",
      signal
    }, 10_000);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Fragen konnten nicht geladen werden.");
    setQuestions(Array.isArray(body.questions) ? body.questions as TickerQuestion[] : []);
  }, [lectureId]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    const schedule = () => {
      if (!stopped) timer = setTimeout(() => { void poll(); }, document.hidden ? 10_000 : 4_000);
    };
    async function poll() {
      if (stopped) return;
      if (polling.current || mutating.current) {
        schedule();
        return;
      }
      polling.current = true;
      active = new AbortController();
      try {
        await refresh(active.signal);
        if (!stopped) setError("");
      } catch (caught) {
        if (!stopped && !(caught instanceof Error && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "Fragen konnten nicht geladen werden.");
        }
      } finally {
        polling.current = false;
        active = undefined;
        schedule();
      }
    }
    const onVisibility = () => {
      if (!document.hidden) {
        if (timer) clearTimeout(timer);
        if (!polling.current) void poll();
      }
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      active?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function runAction(action: "retry" | "reject", questionId: string) {
    if (mutating.current) return;
    mutating.current = true;
    setBusyId(questionId);
    setError("");
    try {
      const response = await boundedFetch(`/api/lectures/${encodeURIComponent(lectureId)}/student-question-ticker`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-learnbuddy-csrf": csrfToken },
        body: JSON.stringify({ action, questionId })
      }, 65_000);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Änderung konnte nicht gespeichert werden.");
      if (Array.isArray(body.questions)) setQuestions(body.questions as TickerQuestion[]);
      else await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
      await refresh().catch(() => undefined);
    } finally {
      mutating.current = false;
      setBusyId(null);
    }
  }

  async function publish(questionId: string) {
    if (mutating.current) return;
    mutating.current = true;
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
      mutating.current = false;
      setBusyId(null);
    }
  }

  const pendingCount = questions.filter((question) => question.examDraftStatus !== "published" && question.examDraftStatus !== "rejected").length;
  return <aside aria-label="Eingehende Studierendenfragen" className={`student-question-ticker ${className ?? ""}`} data-open={open} data-placement={placement}>
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="student-question-ticker__toggle">
      Fragen{pendingCount ? ` · ${pendingCount}` : ""}
    </button>
    {open && <section aria-label="Fragen und Entwürfe" className="student-question-ticker__panel">
      {error && <p role="status" className="student-question-ticker__error">{error}</p>}
      {questions.length === 0 && <p className="student-question-ticker__empty">Noch keine Fragen.</p>}
      <div className="student-question-ticker__list">
        {questions.map((question) => <StudentQuestionTickerItem
          key={question.id}
          question={question}
          canPublish={canPublish}
          busyId={busyId}
          onPublish={() => void publish(question.id)}
          onRetry={() => void runAction("retry", question.id)}
          onReject={() => void runAction("reject", question.id)}
        />)}
      </div>
      {!canPublish && <p className="student-question-ticker__hint">Veröffentlichen ist verfügbar, wenn die Präsentation läuft und keine andere Fragerunde offen ist.</p>}
    </section>}
  </aside>;
}

async function boundedFetch(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const upstream = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstream?.aborted) controller.abort();
  else upstream?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstream?.removeEventListener("abort", abortFromUpstream);
  }
}
