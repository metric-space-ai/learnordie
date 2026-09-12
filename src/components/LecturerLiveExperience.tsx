"use client";

import { questionsForSlide } from "@/lib/questions";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { audioFileExtension, recordAudioSnippet } from "@/lib/audio-capture";
import type { Lecture, TranscriptSegment } from "@/lib/types";
import { Presence } from "./Presence";
import { QuizDrawer } from "./QuizDrawer";
import { SlideEngineCanvas } from "./SlideEngineCanvas";

type MotionStyle = CSSProperties & Record<"--lb-i", number>;
type QuestionOrigin = "control" | "hotspot" | "space";
type TranscriptDraft = {
  id: string;
  text: string;
  provider: string;
  confidence: number;
  audioBytes: number;
  startedAt: string;
  endedAt: string;
  mode: "manual" | "auto";
};

const MANUAL_STT_SEGMENT_MS = 1200;
const AUTO_STT_SEGMENT_MS = 6500;
const AUTO_STT_PAUSE_MS = 700;
const MAX_TRANSCRIPT_DRAFTS = 4;
// Live-Fragen: etwa eine Minute Sprechen je Frage, nicht oefter als alle 75 s.
const LIVE_QUESTION_MIN_CHARS = 700;
const LIVE_QUESTION_MIN_INTERVAL_MS = 75_000;
const LIVE_QUESTION_MAX_PENDING_CHARS = 3000;

export function LecturerLiveExperience({ lecture, csrfToken }: { lecture: Lecture; csrfToken: string }) {
  const [slide, setSlide] = useState(0);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [questionOrigin, setQuestionOrigin] = useState<QuestionOrigin>("control");
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSegmenting, setAutoSegmenting] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>(lecture.transcriptSegments ?? []);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [transcriptSavingId, setTranscriptSavingId] = useState<string | null>(null);
  const [transcriptDrafts, setTranscriptDrafts] = useState<TranscriptDraft[]>([]);
  const [sttStatus, setSttStatus] = useState<"idle" | "requesting" | "listening" | "transcribing" | "ready" | "error">("idle");
  const [questions, setQuestions] = useState(lecture.questions);
  const [liveQuestionsOn, setLiveQuestionsOn] = useState(true);
  const [liveQuestionStatus, setLiveQuestionStatus] = useState<"idle" | "collecting" | "generating" | "error">("idle");
  const [liveQuestionMessage, setLiveQuestionMessage] = useState("");
  const liveQuestionsOnRef = useRef(true);
  const pendingTranscriptRef = useRef("");
  const liveGeneratingRef = useRef(false);
  const lastLiveQuestionAtRef = useRef(0);
  const livePipelineRef = useRef<((draft: TranscriptDraft, slideIndex: number) => Promise<void>) | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const autoSegmentingRef = useRef(false);
  const autoLoopRunningRef = useRef(false);
  const slideRef = useRef(slide);

  const previous = useCallback(() => setSlide((current) => (current + lecture.slides.length - 1) % lecture.slides.length), [lecture.slides.length]);
  const next = useCallback(() => setSlide((current) => (current + 1) % lecture.slides.length), [lecture.slides.length]);

  function stopListening() {
    autoSegmentingRef.current = false;
    setAutoSegmenting(false);
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setListening(false);
    setSttStatus("idle");
    setTranscriptMessage("");
  }

  async function startListening() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setTranscriptMessage("Kein Mikrofon verfügbar.");
      setSttStatus("error");
      return;
    }

    try {
      setTranscriptMessage("");
      setSttStatus("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = stream;
      setListening(true);
      setSttStatus("listening");
      setTranscriptMessage("");
    } catch {
      setListening(false);
      setSttStatus("error");
      setTranscriptMessage("Mikrofon nicht freigegeben.");
    }
  }

  const transcribeAudioBlob = useCallback(async (audio: Blob, startedAt: string, endedAt: string, slideIndex: number, mode: TranscriptDraft["mode"]) => {
    const formData = new FormData();
    formData.set("audio", audio, `lecture-audio-${Date.now()}.${audioFileExtension(audio)}`);
    formData.set("slideTopic", lecture.slides[slideIndex]?.topic ?? lecture.title);
    formData.set("startedAt", startedAt);
    formData.set("endedAt", endedAt);
    const response = await fetch(`/api/lectures/${lecture.id}/stt`, {
      method: "POST",
      headers: { "x-learnbuddy-csrf": csrfToken },
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "Transkription fehlgeschlagen.");
    }

    const draft: TranscriptDraft = {
      id: `transcript-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: payload.text,
      provider: payload.provider,
      confidence: payload.confidence,
      audioBytes: payload.audioBytes,
      startedAt: payload.startedAt ?? startedAt,
      endedAt: payload.endedAt ?? endedAt,
      mode
    };
    setTranscriptDrafts((current) => [draft, ...current].slice(0, MAX_TRANSCRIPT_DRAFTS));
    setTranscriptMessage("");
    setSttStatus("ready");
    return draft;
  }, [csrfToken, lecture.id, lecture.slides, lecture.title]);

  async function transcribeCurrentPassage() {
    const stream = mediaStreamRef.current;
    if (!stream || !listening) {
      setTranscriptMessage("Erst Mikrofon einschalten.");
      return;
    }
    if (autoSegmenting) {
      setTranscriptMessage("");
      return;
    }

    setTranscriptMessage("");
    setSttStatus("transcribing");
    const startedAt = new Date().toISOString();
    try {
      const audio = await recordAudioSnippet(stream, MANUAL_STT_SEGMENT_MS);
      const endedAt = new Date().toISOString();
      await transcribeAudioBlob(audio, startedAt, endedAt, slideRef.current, "manual");
    } catch (error) {
      setTranscriptMessage(error instanceof Error ? error.message : "Aufnahme fehlgeschlagen.");
      setSttStatus("error");
    }
  }

  async function persistTranscriptDraft(draft: TranscriptDraft) {
    const response = await fetch(`/api/lectures/${lecture.id}/transcript-segments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-learnbuddy-csrf": csrfToken
      },
      body: JSON.stringify({
        text: draft.text.slice(0, 1200),
        provider: draft.provider,
        startedAt: draft.startedAt,
        endedAt: draft.endedAt
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Transkript konnte nicht gespeichert werden.");
    setTranscriptSegments((current) => [payload.segment, ...current]);
    setTranscriptDrafts((current) => current.filter((item) => item.id !== draft.id));
    return payload.segment as TranscriptSegment;
  }

  async function generateLiveQuestion(slideIndex: number, transcript: string) {
    const slideId = lecture.slides[slideIndex]?.id;
    if (!slideId || liveGeneratingRef.current) return;
    liveGeneratingRef.current = true;
    setLiveQuestionStatus("generating");
    setLiveQuestionMessage("");
    try {
      const response = await fetch(`/api/lectures/${lecture.id}/live-questions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-learnbuddy-csrf": csrfToken },
        body: JSON.stringify({ slideId, transcript })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Frage konnte nicht erzeugt werden.");
      setQuestions(payload.questions);
      pendingTranscriptRef.current = "";
      lastLiveQuestionAtRef.current = Date.now();
      const preview = (payload.family as Array<{ level: string; text: string }> | undefined)?.find((item) => item.level === "2.0");
      setLiveQuestionStatus("collecting");
      setLiveQuestionMessage(`Neue Frage auf Folie ${slideIndex + 1}${preview ? `: ${preview.text}` : ""}`);
    } catch (error) {
      setLiveQuestionStatus("error");
      setLiveQuestionMessage(error instanceof Error ? error.message : "Frage konnte nicht erzeugt werden.");
    } finally {
      liveGeneratingRef.current = false;
    }
  }

  // Pipeline: Auto-Segment uebernehmen, Transkript sammeln, ab genug Text eine Familie erzeugen.
  // Die Funktion wird nach jedem Render aktualisiert, damit die Aufnahmeschleife aktuelle Werte sieht.
  useEffect(() => {
    livePipelineRef.current = async (draft, slideIndex) => {
      try {
        await persistTranscriptDraft(draft);
      } catch (error) {
        setLiveQuestionMessage(error instanceof Error ? error.message : "Transkript konnte nicht gespeichert werden.");
        return;
      }
      pendingTranscriptRef.current = `${pendingTranscriptRef.current} ${draft.text}`.trim().slice(-LIVE_QUESTION_MAX_PENDING_CHARS);
      setLiveQuestionStatus((current) => (current === "idle" ? "collecting" : current));
      const enoughText = pendingTranscriptRef.current.length >= LIVE_QUESTION_MIN_CHARS;
      const pausedLongEnough = Date.now() - lastLiveQuestionAtRef.current >= LIVE_QUESTION_MIN_INTERVAL_MS;
      if (enoughText && pausedLongEnough) {
        void generateLiveQuestion(slideIndex, pendingTranscriptRef.current);
      }
    };
  });

  async function submitTranscriptSegment(draftId: string) {
    const draft = transcriptDrafts.find((item) => item.id === draftId);
    if (!draft) return;
    setTranscriptSavingId(draft.id);
    setTranscriptMessage("");

    const response = await fetch(`/api/lectures/${lecture.id}/transcript-segments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-learnbuddy-csrf": csrfToken
      },
      body: JSON.stringify({
        text: draft.text,
        provider: draft.provider,
        startedAt: draft.startedAt,
        endedAt: draft.endedAt
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setTranscriptMessage(payload.error ?? "Transkript konnte nicht gespeichert werden.");
      setTranscriptSavingId(null);
      return;
    }

    setTranscriptSegments((current) => [payload.segment, ...current]);
    setTranscriptDrafts((current) => current.filter((item) => item.id !== draft.id));
    setTranscriptMessage(payload.message ?? "Transkript gespeichert.");
    setTranscriptSavingId(null);
  }

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((event.key === "f" || event.key === "F") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        toggleFullscreen();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setQuestionOrigin("space");
        setQuestionOpen((current) => !current);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    autoSegmentingRef.current = false;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    slideRef.current = slide;
  }, [slide]);

  useEffect(() => {
    autoSegmentingRef.current = autoSegmenting;
  }, [autoSegmenting]);

  useEffect(() => {
    liveQuestionsOnRef.current = liveQuestionsOn;
  }, [liveQuestionsOn]);

  useEffect(() => {
    if (!autoSegmenting || !listening || autoLoopRunningRef.current) return;

    let cancelled = false;
    autoLoopRunningRef.current = true;
    setTranscriptMessage("");

    async function runAutoLoop() {
      while (!cancelled && autoSegmentingRef.current && mediaStreamRef.current) {
        const stream = mediaStreamRef.current;
        const startedAt = new Date().toISOString();
        setSttStatus("transcribing");
        try {
          const audio = await recordAudioSnippet(stream, AUTO_STT_SEGMENT_MS);
          const endedAt = new Date().toISOString();
          const slideIndex = slideRef.current;
          const draft = await transcribeAudioBlob(audio, startedAt, endedAt, slideIndex, "auto");
          if (liveQuestionsOnRef.current && draft.text.trim()) {
            await livePipelineRef.current?.(draft, slideIndex);
          }
        } catch (error) {
          if (!cancelled) {
            setTranscriptMessage(error instanceof Error ? error.message : "Automatische Transkription fehlgeschlagen.");
            setSttStatus("error");
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, AUTO_STT_PAUSE_MS));
      }

      autoLoopRunningRef.current = false;
      if (!cancelled && listening) {
        setSttStatus("listening");
        setTranscriptMessage("");
      }
    }

    void runAutoLoop();
    return () => {
      cancelled = true;
      autoSegmentingRef.current = false;
    };
  }, [autoSegmenting, listening, transcribeAudioBlob]);

  return (
    <main
      className={`slide-screen lb-motion-root ${questionOpen ? "question-open" : ""}`}
      data-question-origin={questionOrigin}
    >
      <SlideEngineCanvas
        current={slide}
        onNext={next}
        onPrevious={previous}
        slideDocument={lecture.slideDocument}
        slides={lecture.slides}
      />

      <Presence show={transcriptVisible}>
        {(motionState) => (
        <aside className="transcript-panel lb-enter-overlay" data-panel-origin="transcript" data-state={motionState} aria-label="Transkriptstatus">
          <div className="overlay-head">
            <h2>Transkript</h2>
            <button type="button" aria-label="Transkript ausblenden" title="Transkript ausblenden" onClick={() => setTranscriptVisible(false)}>×</button>
          </div>
          <p className="lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
            <span className={`status-dot ${listening ? "live" : ""}`} />
            {sttStatus === "requesting"
              ? "Mikrofon wird freigegeben"
              : sttStatus === "transcribing"
                ? "Transkribiert …"
                : listening
                  ? (autoSegmenting ? "Hört zu · automatisch" : "Hört zu")
                  : "Mikrofon aus"}
          </p>
          {transcriptDrafts.length > 0 && (
            <div className="transcript-draft-list lb-enter-row" style={{ "--lb-i": 2 } as MotionStyle} aria-label="Neues Transkript">
              {transcriptDrafts.map((draft) => (
                <div className="transcript-draft" key={draft.id}>
                  <p>{draft.text}</p>
                  <button className="plain-button" disabled={transcriptSavingId === draft.id} type="button" onClick={() => submitTranscriptSegment(draft.id)}>
                    {transcriptSavingId === draft.id ? "Speichert" : "Übernehmen"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {transcriptMessage && <p className="form-note lb-enter-row" style={{ "--lb-i": 3 } as MotionStyle}>{transcriptMessage}</p>}
          {transcriptSegments.length > 0 && (
            <div className="transcript-mini-list" aria-label="Übernommenes Transkript">
              {transcriptSegments.slice(0, 3).map((segment, index) => (
                <span
                  className={`${segment.status} lb-enter-row`}
                  key={segment.id}
                  style={{ "--lb-i": index + 4 } as MotionStyle}
                >
                  {segment.text}
                </span>
              ))}
            </div>
          )}
          <div className="transcript-actions lb-enter-row" style={{ "--lb-i": 7 } as MotionStyle}>
            <button className="plain-button" type="button" onClick={listening ? stopListening : startListening}>
              {listening ? "Mikrofon aus" : "Mikrofon an"}
            </button>
            <button className="plain-button" disabled={!listening || sttStatus === "transcribing" || autoSegmenting} type="button" onClick={transcribeCurrentPassage}>
              Jetzt transkribieren
            </button>
            <button
              className="plain-button"
              disabled={!listening}
              type="button"
              aria-pressed={autoSegmenting}
              onClick={() => setAutoSegmenting((current) => !current)}
            >
              Automatisch
            </button>
          </div>
          <div className="live-question-pipeline lb-enter-row" style={{ "--lb-i": 9 } as MotionStyle} aria-label="Live-Fragen aus dem Transkript" data-status={liveQuestionStatus}>
            <div className="transcript-actions">
              <button
                className="plain-button"
                type="button"
                aria-pressed={liveQuestionsOn}
                onClick={() => setLiveQuestionsOn((current) => !current)}
              >
                {liveQuestionsOn ? "Live-Fragen an" : "Live-Fragen aus"}
              </button>
              <button
                className="plain-button"
                type="button"
                disabled={liveQuestionStatus === "generating"}
                onClick={() => generateLiveQuestion(slide, pendingTranscriptRef.current)}
              >
                {liveQuestionStatus === "generating" ? "Erzeugt …" : "Frage erzeugen"}
              </button>
            </div>
            {liveQuestionMessage ? <p className="form-note" aria-live="polite">{liveQuestionMessage}</p> : null}
          </div>
        </aside>
        )}
      </Presence>

      <div className="action-stack lb-enter-control">
        <a className="live-back-link" href="/lecturer">Beenden</a>
        <button
          className="icon-action"
          type="button"
          title="Transkript und Mikrofon"
          aria-label="Transkript und Mikrofon"
          aria-pressed={transcriptVisible}
          onClick={() => setTranscriptVisible((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <button
          className="icon-action"
          type="button"
          title="Vollbild (Taste F)"
          aria-label="Vollbild"
          aria-pressed={fullscreen}
          onClick={toggleFullscreen}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {fullscreen
              ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
        </button>
        <button
          className="icon-action"
          type="button"
          title="Quiz (Leertaste)"
          aria-label="Quiz (Leertaste)"
          aria-pressed={questionOpen}
          onClick={() => {
            setQuestionOrigin("control");
            setQuestionOpen((current) => !current);
          }}
        >
          <span className="lb-icon lb-icon-question" aria-hidden="true" />
        </button>
      </div>

      <Presence show={questionOpen}>
        {(motionState) => (
          <QuizDrawer
            key={lecture.slides[slide]?.id}
            questions={questionsForSlide(questions, lecture.slides[slide]?.id)}
            origin={questionOrigin}
            motionState={motionState}
          />
        )}
      </Presence>
    </main>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}
