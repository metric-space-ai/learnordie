"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { audioFileExtension, recordAudioSnippet } from "@/lib/audio-capture";
import type { Lecture, TranscriptSegment } from "@/lib/types";
import { Presence } from "./Presence";
import { SlideCanvas } from "./SlideCanvas";

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

export function LecturerLiveExperience({ lecture, csrfToken }: { lecture: Lecture; csrfToken: string }) {
  const [slide, setSlide] = useState(0);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [questionOrigin, setQuestionOrigin] = useState<QuestionOrigin>("control");
  const [transcriptVisible, setTranscriptVisible] = useState(true);
  const [listening, setListening] = useState(false);
  const [autoSegmenting, setAutoSegmenting] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>(lecture.transcriptSegments ?? []);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [transcriptSavingId, setTranscriptSavingId] = useState<string | null>(null);
  const [transcriptDrafts, setTranscriptDrafts] = useState<TranscriptDraft[]>([]);
  const [sttStatus, setSttStatus] = useState<"idle" | "requesting" | "listening" | "transcribing" | "ready" | "error">("idle");
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const autoSegmentingRef = useRef(false);
  const autoLoopRunningRef = useRef(false);
  const slideRef = useRef(slide);

  const previous = useCallback(() => setSlide((current) => (current + lecture.slides.length - 1) % lecture.slides.length), [lecture.slides.length]);
  const next = useCallback(() => setSlide((current) => (current + 1) % lecture.slides.length), [lecture.slides.length]);
  const latestTranscript = transcriptDrafts[0]?.text ?? transcriptSegments[0]?.text ?? "Noch keine Passage übernommen.";
  const transcriptSample = lecture.slides[slide]?.topic === "Stribeck-Kurve"
    ? "Die Stribeck-Kurve zeigt, wie Reibung von Drehzahl, Viskosität und Last abhängt."
    : "Mischreibung ist beim Anlauf kritisch, weil der Schmierfilm noch nicht voll trägt und Festkörperkontakt auftreten kann.";

  function stopListening() {
    autoSegmentingRef.current = false;
    setAutoSegmenting(false);
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setListening(false);
    setSttStatus("idle");
    setTranscriptMessage("Mikrofonstream pausiert.");
  }

  async function startListening() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setTranscriptMessage("Browser-Mikrofon ist nicht verfügbar.");
      setSttStatus("error");
      return;
    }

    try {
      setTranscriptMessage("Mikrofonfreigabe wird angefragt.");
      setSttStatus("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = stream;
      setListening(true);
      setSttStatus("listening");
      setTranscriptMessage("Browser-Mikrofon streamt. Segmente können manuell oder automatisch transkribiert werden.");
    } catch {
      setListening(false);
      setSttStatus("error");
      setTranscriptMessage("Mikrofonfreigabe wurde nicht erteilt.");
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
      throw new Error(payload.error ?? "STT-Proxy konnte die Passage nicht transkribieren.");
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
    setTranscriptMessage(`Transkript bereit: ${Math.round((payload.confidence ?? 0) * 100)}% Konfidenz, ${payload.audioBytes ?? 0} Bytes Audio.`);
    setSttStatus("ready");
  }, [csrfToken, lecture.id, lecture.slides, lecture.title]);

  async function transcribeCurrentPassage() {
    const stream = mediaStreamRef.current;
    if (!stream || !listening) {
      setTranscriptMessage("Erst STT starten und Mikrofon freigeben.");
      return;
    }
    if (autoSegmenting) {
      setTranscriptMessage("Automatische Segmentierung läuft bereits.");
      return;
    }

    setTranscriptMessage("Audiopassage wird an den STT-Proxy gesendet.");
    setSttStatus("transcribing");
    const startedAt = new Date().toISOString();
    try {
      const audio = await recordAudioSnippet(stream, MANUAL_STT_SEGMENT_MS);
      const endedAt = new Date().toISOString();
      await transcribeAudioBlob(audio, startedAt, endedAt, slideRef.current, "manual");
    } catch (error) {
      setTranscriptMessage(error instanceof Error ? error.message : "Audiopassage konnte nicht aufgenommen werden.");
      setSttStatus("error");
    }
  }

  async function submitTranscriptSegment(draftId?: string) {
    const draft = transcriptDrafts.find((item) => item.id === draftId) ?? transcriptDrafts[0];
    if (!draft) {
      setTranscriptMessage("Erst eine Audiopassage transkribieren.");
      return;
    }
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
      setTranscriptMessage(payload.error ?? "Transkriptsegment konnte nicht gespeichert werden.");
      setTranscriptSavingId(null);
      return;
    }

    setTranscriptSegments((current) => [payload.segment, ...current]);
    setTranscriptDrafts((current) => current.filter((item) => item.id !== draft.id));
    setTranscriptMessage(payload.message ?? "Transkriptsegment gespeichert.");
    setTranscriptSavingId(null);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
    if (!autoSegmenting || !listening || autoLoopRunningRef.current) return;

    let cancelled = false;
    autoLoopRunningRef.current = true;
    setTranscriptMessage("Automatische STT-Segmente laufen.");

    async function runAutoLoop() {
      while (!cancelled && autoSegmentingRef.current && mediaStreamRef.current) {
        const stream = mediaStreamRef.current;
        const startedAt = new Date().toISOString();
        setSttStatus("transcribing");
        try {
          const audio = await recordAudioSnippet(stream, AUTO_STT_SEGMENT_MS);
          const endedAt = new Date().toISOString();
          await transcribeAudioBlob(audio, startedAt, endedAt, slideRef.current, "auto");
        } catch (error) {
          if (!cancelled) {
            setTranscriptMessage(error instanceof Error ? error.message : "Automatisches STT-Segment konnte nicht verarbeitet werden.");
            setSttStatus("error");
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, AUTO_STT_PAUSE_MS));
      }

      autoLoopRunningRef.current = false;
      if (!cancelled && listening) {
        setSttStatus("listening");
        setTranscriptMessage("Automatische STT-Segmente pausiert.");
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
      <SlideCanvas slides={lecture.slides} current={slide} onPrevious={previous} onNext={next} />

      <Presence show={transcriptVisible}>
        {(motionState) => (
        <aside className="transcript-panel lb-enter-overlay" data-panel-origin="transcript" data-state={motionState} aria-label="Transkriptstatus">
          <div className="overlay-head">
            <h2>Transkript</h2>
            <button type="button" aria-label="Transkript ausblenden" onClick={() => setTranscriptVisible(false)}>×</button>
          </div>
          <p className="lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
            <span className={`status-dot ${listening ? "live" : ""}`} />
            {sttStatus === "requesting"
              ? "Mikrofonfreigabe läuft"
              : sttStatus === "transcribing"
                ? "STT-Proxy transkribiert"
                : autoSegmenting
                  ? "Automatische Segmente laufen"
                  : listening
                  ? "Browser-Mikrofon streamt"
                  : "Mikrofon wartet"}
          </p>
          <p className="muted lb-enter-row" style={{ "--lb-i": 1 } as MotionStyle}>Letzte Passage: {latestTranscript}</p>
          {transcriptDrafts.length > 0 ? (
            <div className="transcript-draft-list lb-enter-row" style={{ "--lb-i": 2 } as MotionStyle} aria-label="STT-Kandidaten">
              {transcriptDrafts.map((draft) => (
                <div className="transcript-draft" key={draft.id}>
                  <p>{draft.mode === "auto" ? "Auto-Segment" : "Manuelle Passage"} · {draft.text}</p>
                  <button className="plain-button" disabled={transcriptSavingId === draft.id} type="button" onClick={() => submitTranscriptSegment(draft.id)}>
                    {transcriptSavingId === draft.id ? "Speichert" : "Übernehmen"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="form-note lb-enter-row" style={{ "--lb-i": 2 } as MotionStyle}>Fachlicher Fallback: {transcriptSample}</p>
          )}
          {transcriptMessage && <p className="form-note lb-enter-row" style={{ "--lb-i": 3 } as MotionStyle}>{transcriptMessage}</p>}
          {transcriptSegments.length > 0 && (
            <div className="transcript-mini-list" aria-label="Übernommene Transkriptsegmente">
              {transcriptSegments.slice(0, 3).map((segment, index) => (
                <span
                  className={`${segment.status} lb-enter-row`}
                  key={segment.id}
                  style={{ "--lb-i": index + 4 } as MotionStyle}
                >
                  {segment.status === "accepted" ? "Quelle" : "Ignoriert"} · {segment.text}
                </span>
              ))}
            </div>
          )}
          <div className="transcript-actions lb-enter-row" style={{ "--lb-i": 7 } as MotionStyle}>
            <button className="plain-button" type="button" onClick={listening ? stopListening : startListening}>
              {listening ? "STT pausieren" : "STT starten"}
            </button>
            <button className="plain-button" disabled={!listening || sttStatus === "transcribing" || autoSegmenting} type="button" onClick={transcribeCurrentPassage}>
              {sttStatus === "transcribing" ? "Transkribiert" : "Passage transkribieren"}
            </button>
            <button className="plain-button" disabled={!listening} type="button" onClick={() => setAutoSegmenting((current) => !current)}>
              {autoSegmenting ? "Auto stoppen" : "Auto-Segmente"}
            </button>
          </div>
          <button className="primary-button lb-enter-row" style={{ "--lb-i": 8 } as MotionStyle} disabled={transcriptDrafts.length < 1 || Boolean(transcriptSavingId)} type="button" onClick={() => submitTranscriptSegment()}>
            {transcriptSavingId ? "Speichert" : "Neueste Passage übernehmen"}
          </button>
        </aside>
        )}
      </Presence>

      <div className="action-stack lb-enter-control">
        <button
          className="icon-action"
          type="button"
          title="Fragen mit Leertaste ein-/ausklappen"
          aria-label="Fragen ein- oder ausklappen"
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
        <section
          className="question-drawer compact lb-enter-sheet"
          data-origin={questionOrigin}
          data-state={motionState}
          aria-label="Live-Fragen"
        >
          <div className="drawer-main">
            <p className="question lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>Live-Fragen für diese Folie</p>
            <div className="answers">
              {lecture.questions.map((question, index) => (
                <div
                  className="lecturer-question lb-enter-row"
                  key={question.level}
                  style={{ "--lb-i": index + 1 } as MotionStyle}
                >
                  <strong>Niveau {question.level}</strong>
                  <span>{question.text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        )}
      </Presence>
    </main>
  );
}
