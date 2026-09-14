"use client";

import { groupQuestionFamilies, questionsForSlide } from "@/lib/questions";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { audioFileExtension, recordAudioSnippet, startContinuousWavCapture } from "@/lib/audio-capture";
import type { RecordedPassage } from "@/lib/audio-capture";
import { transcriptRecordingStatus, type TranscriptionPhase } from "@/lib/transcript-recording-status";
import { LiveOperationScope, type LiveOperation } from "@/lib/live-operation-scope";
import { presenterQuestionShortcut } from "@/lib/presenter-question-shortcut";
import { currentSessionTranscript } from "@/lib/session-transcript";
import type { Lecture, TranscriptSegment } from "@/lib/types";
import { useLiveSession } from "@/lib/use-live-session";
import { LeaderboardModal } from "./LeaderboardModal";
import { Presence } from "./Presence";
import { PresenterRoundStatus } from "./PresenterRoundStatus";
import { SlideEngineCanvas } from "./SlideEngineCanvas";
import { StudentQuestionTicker } from "./StudentQuestionTicker";
import { ThemeToggle } from "./theme/ThemeToggle";

type MotionStyle = CSSProperties & Record<"--lb-i", number>;
type QuestionOrigin = "control" | "hotspot" | "space";
type TranscriptDraft = {
  operation: LiveOperation;
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
const MAX_QUEUED_PASSAGES = 12;
const MAX_TRANSCRIPT_DRAFTS = 4;
// Live-Fragen: etwa eine Minute Sprechen je Frage, nicht oefter als alle 75 s.
const LIVE_QUESTION_MIN_CHARS = 700;
const LIVE_QUESTION_MIN_INTERVAL_MS = 75_000;
const LIVE_QUESTION_MAX_PENDING_CHARS = 3000;

export function LecturerLiveExperience({ lecture, csrfToken }: { lecture: Lecture; csrfToken: string }) {
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const controlsRef = useRef<HTMLDetailsElement>(null);
  const live = useLiveSession(lecture.publicToken, lecture.leaderboardEnabled, { id: lecture.id, csrfToken });
  const sendLive = live.send;
  const liveStatus = live.state?.status;
  const slide = Math.min(live.state?.slideIndex ?? 0, Math.max(0, lecture.slides.length - 1));
  const showJoinIntro = liveStatus === "ended" || (live.state?.showIntro ?? true);
  const questionOpen = Boolean(live.connected && live.state?.round);
  const [familyIndex, setFamilyIndex] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const startAttempted = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [questionOrigin, setQuestionOrigin] = useState<QuestionOrigin>("control");
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSegmenting, setAutoSegmenting] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>(lecture.transcriptSegments ?? []);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [transcriptSavingId, setTranscriptSavingId] = useState<string | null>(null);
  const [transcriptDrafts, setTranscriptDrafts] = useState<TranscriptDraft[]>([]);
  const [sttStatus, setSttStatus] = useState<TranscriptionPhase>("idle");
  const [lastTranscriptAt, setLastTranscriptAt] = useState(0);
  const [transcriptPending, setTranscriptPending] = useState(0);
  const [statusClock, setStatusClock] = useState(0);
  const [questions, setQuestions] = useState(lecture.questions);
  const families = groupQuestionFamilies(questionsForSlide(questions, lecture.slides[slide]?.id));
  const [liveQuestionsOn, setLiveQuestionsOn] = useState(true);
  const [liveQuestionStatus, setLiveQuestionStatus] = useState<"idle" | "collecting" | "generating" | "error">("idle");
  const [liveQuestionMessage, setLiveQuestionMessage] = useState("");
  const liveQuestionsOnRef = useRef(true);
  const pendingTranscriptRef = useRef("");
  const recentSpeechRef = useRef({ text: "", endedAt: 0 });
  const liveGeneratingRef = useRef(false);
  const lastLiveQuestionAtRef = useRef(0);
  const livePipelineRef = useRef<((draft: TranscriptDraft, slideIndex: number) => Promise<void>) | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const autoSegmentingRef = useRef(false);
  const microphoneRequestRef = useRef(0);
  const disposedRef = useRef(false);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const slideRef = useRef(slide);
  const dynamicRoundRef = useRef<((mode?: "transcript-only") => Promise<void>) | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const sessionScopeRef = useRef(new LiveOperationScope());
  const activeSessionId = liveStatus === "active" ? live.state?.sessionId ?? null : null;
  const visibleTranscript = currentSessionTranscript(transcriptSegments, activeSessionId ? live.state?.sessionStartedAt ?? null : null).slice(-3).reverse();
  const [roundMessage, setRoundMessage] = useState("");

  useEffect(() => {
    if (!sessionScopeRef.current.setSession(activeSessionId)) return;
    transcriptionAbortRef.current?.abort();
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    liveGeneratingRef.current = false;
    recentSpeechRef.current = { text: "", endedAt: 0 };
    pendingTranscriptRef.current = "";
    lastLiveQuestionAtRef.current = 0;
    setLastTranscriptAt(0);
    setTranscriptPending(0);
    setTranscriptDrafts([]);
    setLiveQuestionStatus("idle");
    setLiveQuestionMessage("");
    setRoundMessage("");
    if (!activeSessionId) stopListening();
  }, [activeSessionId]);

  // This handler is refreshed without capturing the slide while a provider is
  // in flight. Its result is explicitly bound to the original family/session.
  useEffect(() => {
    dynamicRoundRef.current = async (mode) => {
      if (showJoinIntro || liveStatus !== "active" || !live.connected || live.busy || questionOpen || liveGeneratingRef.current) return;
      const recentSpeech = recentSpeechRef.current;
      if (mode === "transcript-only" && (Date.now() - recentSpeech.endedAt > 120_000 || recentSpeech.text.length < 120)) {
        setRoundMessage("Noch kein ausreichend langes aktuelles Transkript. Mikrofon einschalten und die nächste Passage abwarten.");
        return;
      }
      const slideId = lecture.slides[slide]?.id;
      const sessionId = live.state?.sessionId;
      const operation = sessionScopeRef.current.capture();
      if (!slideId || !sessionId || !operation || operation.sessionId !== sessionId) return;
      liveGeneratingRef.current = true;
      setLiveQuestionStatus("generating");
      setRoundMessage("");
      const abort = new AbortController();
      generationAbortRef.current = abort;
      const timeout = setTimeout(() => abort.abort(), 55_000);
      try {
        const response = await fetch(`/api/lectures/${lecture.id}/live-questions`, {
          method: "POST", headers: { "content-type": "application/json", "x-learnbuddy-csrf": csrfToken },
          body: JSON.stringify({ slideId, mode, sessionId, transcript: mode ? recentSpeech.text : pendingTranscriptRef.current, allowSlideContext: !mode }), signal: AbortSignal.any([abort.signal, operation.signal])
        });
        const payload = await response.json();
        if (!sessionScopeRef.current.isCurrent(operation)) return;
        if (!response.ok) throw new Error(payload.error ?? "Frage konnte nicht erzeugt werden.");
        const familyId = payload.family?.[0]?.familyId as string | undefined;
        if (!familyId) throw new Error("Die erzeugte Frage ist noch nicht verfügbar.");
        setQuestions(payload.questions);
        const sent = await sendLive({ action: "fire", familyIndex: 0, familyId, sessionId, durationSeconds: 60 });
        if (!sessionScopeRef.current.isCurrent(operation)) return;
        if (!sent) throw new Error("Frage erstellt, aber nicht gesendet. Bitte im Menü erneut starten.");
        setLiveQuestionStatus("idle");
      } catch (error) {
        if (generationAbortRef.current === abort) {
          setLiveQuestionStatus("error");
          setRoundMessage(error instanceof Error && error.name !== "AbortError" ? error.message : `Fragenerstellung dauert zu lange. ${mode === "transcript-only" ? "Shift+Leertaste" : "Leertaste"} zum erneuten Versuch.`);
        }
      } finally {
        clearTimeout(timeout);
        if (generationAbortRef.current === abort) {
          generationAbortRef.current = null;
          liveGeneratingRef.current = false;
        }
      }
    };
  });

  useEffect(() => {
    if (liveStatus === "waiting" && !startAttempted.current) {
      startAttempted.current = true;
      void sendLive({ action: "start" });
    }
  }, [liveStatus, sendLive]);

  const toggleQuestion = useCallback(() => {
    void sendLive(questionOpen ? { action: "close" } : { action: "fire", familyIndex, durationSeconds });
  }, [sendLive, questionOpen, familyIndex, durationSeconds]);

  const previous = useCallback(() => {
    setFamilyIndex(0);
    void sendLive({ action: "slide", slideIndex: Math.max(0, slide - 1), showIntro: slide === 0 });
  }, [slide, sendLive]);
  const next = useCallback(() => {
    setFamilyIndex(0);
    void sendLive({ action: "slide", slideIndex: showJoinIntro ? 0 : Math.min(slide + 1, lecture.slides.length - 1), showIntro: false });
  }, [showJoinIntro, slide, lecture.slides.length, sendLive]);

  const publishStudentDraft = useCallback(async (questionId: string) => {
    const operation = sessionScopeRef.current.capture();
    if (!operation || showJoinIntro || !live.connected || live.busy || questionOpen || liveGeneratingRef.current) return false;
    // The command carries the current revision; a concurrent slide/session change
    // is rejected by the server rather than publishing into a different session.
    const published = await sendLive({ action: "publishDraft", questionId });
    return sessionScopeRef.current.isCurrent(operation) && published;
  }, [showJoinIntro, live.connected, live.busy, questionOpen, sendLive]);

  function stopListening() {
    microphoneRequestRef.current += 1;
    autoSegmentingRef.current = false;
    setAutoSegmenting(false);
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setListening(false);
    setSttStatus("idle");
    setTranscriptMessage("");
  }

  async function startListening() {
    if (!sessionScopeRef.current.capture()) {
      setTranscriptMessage("Zuerst die Live-Sitzung starten.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setTranscriptMessage("Kein Mikrofon verfügbar.");
      setSttStatus("error");
      return;
    }

    const requestId = ++microphoneRequestRef.current;
    try {
      setTranscriptMessage("");
      setSttStatus("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestId !== microphoneRequestRef.current || disposedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = stream;
      setListening(true);
      autoSegmentingRef.current = true;
      setAutoSegmenting(true);
      setSttStatus("listening");
      setTranscriptMessage("");
    } catch {
      if (requestId !== microphoneRequestRef.current || disposedRef.current) return;
      setListening(false);
      setSttStatus("error");
      setTranscriptMessage("Mikrofon nicht freigegeben.");
    }
  }

  const transcribeAudioBlob = useCallback(async (audio: Blob, startedAt: string, endedAt: string, slideIndex: number, mode: TranscriptDraft["mode"], operation: LiveOperation, signal?: AbortSignal) => {
    if (!sessionScopeRef.current.isCurrent(operation)) throw new DOMException("Session ended", "AbortError");
    const formData = new FormData();
    formData.set("audio", audio, `lecture-audio-${Date.now()}.${audioFileExtension(audio)}`);
    formData.set("slideTopic", lecture.slides[slideIndex]?.topic ?? lecture.title);
    formData.set("startedAt", startedAt);
    formData.set("endedAt", endedAt);
    formData.set("sessionId", operation.sessionId);
    const response = await fetch(`/api/lectures/${lecture.id}/stt`, {
      method: "POST",
      headers: { "x-learnbuddy-csrf": csrfToken },
      body: formData,
      signal: AbortSignal.any([AbortSignal.timeout(55_000), operation.signal, ...(signal ? [signal] : [])])
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "Transkription fehlgeschlagen.");
    }

    const draft: TranscriptDraft = {
      operation,
      id: `transcript-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: payload.text,
      provider: payload.provider,
      confidence: payload.confidence,
      audioBytes: payload.audioBytes,
      startedAt: payload.startedAt ?? startedAt,
      endedAt: payload.endedAt ?? endedAt,
      mode
    };
    if (disposedRef.current || !sessionScopeRef.current.isCurrent(operation)) throw new DOMException("Cancelled", "AbortError");
    if (draft.text.trim()) setTranscriptDrafts((current) => [draft, ...current].slice(0, MAX_TRANSCRIPT_DRAFTS));
    setTranscriptMessage("");
    setSttStatus(mediaStreamRef.current ? (draft.text.trim() ? "transcribing" : "listening") : "idle");
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
    const operation = sessionScopeRef.current.capture();
    if (!operation) return;
    try {
      const audio = await recordAudioSnippet(stream, MANUAL_STT_SEGMENT_MS);
      const endedAt = new Date().toISOString();
      await transcribeAudioBlob(audio, startedAt, endedAt, slideRef.current, "manual", operation);
    } catch (error) {
      if (!sessionScopeRef.current.isCurrent(operation)) return;
      setTranscriptMessage(error instanceof Error ? error.message : "Aufnahme fehlgeschlagen.");
      setSttStatus("error");
    }
  }

  async function persistTranscriptDraft(draft: TranscriptDraft) {
    if (!sessionScopeRef.current.isCurrent(draft.operation)) throw new DOMException("Session ended", "AbortError");
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
        endedAt: draft.endedAt,
        sessionId: draft.operation.sessionId
      }),
      signal: AbortSignal.any([AbortSignal.timeout(20_000), draft.operation.signal])
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Transkript konnte nicht gespeichert werden.");
    if (disposedRef.current || !sessionScopeRef.current.isCurrent(draft.operation)) throw new DOMException("Session ended", "AbortError");
    setTranscriptSegments((current) => [payload.segment, ...current]);
    setTranscriptDrafts((current) => current.filter((item) => item.id !== draft.id));
    if (payload.segment.status === "accepted") {
      const endedAt = Date.parse(draft.endedAt);
      const previous = recentSpeechRef.current;
      recentSpeechRef.current = { text: `${endedAt - previous.endedAt < 120_000 ? previous.text : ""} ${draft.text}`.trim().slice(-LIVE_QUESTION_MAX_PENDING_CHARS), endedAt };
      setLastTranscriptAt(endedAt);
      setSttStatus(mediaStreamRef.current ? "ready" : "idle");
    }
    return payload.segment as TranscriptSegment;
  }

  async function generateLiveQuestion(slideIndex: number, transcript: string) {
    const slideId = lecture.slides[slideIndex]?.id;
    const operation = sessionScopeRef.current.capture();
    if (!slideId || liveGeneratingRef.current || !operation) return;
    const abort = new AbortController();
    generationAbortRef.current = abort;
    liveGeneratingRef.current = true;
    setLiveQuestionStatus("generating");
    setLiveQuestionMessage("");
    try {
      const response = await fetch(`/api/lectures/${lecture.id}/live-questions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-learnbuddy-csrf": csrfToken },
        body: JSON.stringify({ slideId, transcript, sessionId: operation.sessionId, mode: "transcript-only" }),
        signal: AbortSignal.any([AbortSignal.timeout(55_000), abort.signal, operation.signal])
      });
      const payload = await response.json().catch(() => ({}));
      if (!sessionScopeRef.current.isCurrent(operation)) return;
      if (!response.ok) throw new Error(payload.error ?? "Frage konnte nicht erzeugt werden.");
      setQuestions(payload.questions);
      // Newly generated STT families become explicitly selectable for broadcast.
      if (slideRef.current === slideIndex) {
        setFamilyIndex(Math.max(0, groupQuestionFamilies(questionsForSlide(payload.questions, slideId)).length - 1));
      }
      // Keep speech accepted while this request was in flight for the next family.
      if (pendingTranscriptRef.current.startsWith(transcript)) {
        pendingTranscriptRef.current = pendingTranscriptRef.current.slice(transcript.length).trim();
      }
      lastLiveQuestionAtRef.current = Date.now();
      const preview = (payload.family as Array<{ level: string; text: string }> | undefined)?.find((item) => item.level === "2.0");
      setLiveQuestionStatus("collecting");
      setLiveQuestionMessage(`Neue Frage auf Folie ${slideIndex + 1}${preview ? `: ${preview.text}` : ""}`);
    } catch (error) {
      if (!sessionScopeRef.current.isCurrent(operation)) return;
      setLiveQuestionStatus("error");
      setLiveQuestionMessage(error instanceof Error ? error.message : "Frage konnte nicht erzeugt werden.");
    } finally {
      if (generationAbortRef.current === abort) {
        generationAbortRef.current = null;
        liveGeneratingRef.current = false;
      }
    }
  }

  // Pipeline: Auto-Segment uebernehmen, Transkript sammeln, ab genug Text eine Familie erzeugen.
  // Die Funktion wird nach jedem Render aktualisiert, damit die Aufnahmeschleife aktuelle Werte sieht.
  useEffect(() => {
    livePipelineRef.current = async (draft, slideIndex) => {
      const segment = await persistTranscriptDraft(draft);
      if (segment.status !== "accepted" || !sessionScopeRef.current.isCurrent(draft.operation)) return;
      pendingTranscriptRef.current = `${pendingTranscriptRef.current} ${draft.text}`.trim().slice(-LIVE_QUESTION_MAX_PENDING_CHARS);
      setLiveQuestionStatus((current) => (current === "idle" ? "collecting" : current));
      const enoughText = pendingTranscriptRef.current.length >= LIVE_QUESTION_MIN_CHARS;
      const pausedLongEnough = Date.now() - lastLiveQuestionAtRef.current >= LIVE_QUESTION_MIN_INTERVAL_MS;
      if (liveQuestionsOnRef.current && enoughText && pausedLongEnough) {
        void generateLiveQuestion(slideIndex, pendingTranscriptRef.current);
      }
    };
  });

  async function submitTranscriptSegment(draftId: string) {
    const draft = transcriptDrafts.find((item) => item.id === draftId);
    if (!draft) return;
    setTranscriptSavingId(draft.id);
    setTranscriptMessage("");

    try {
      await livePipelineRef.current?.(draft, slideRef.current);
    } catch (error) {
      if (!sessionScopeRef.current.isCurrent(draft.operation)) return;
      setTranscriptMessage(error instanceof Error ? error.message : "Transkript konnte nicht gespeichert werden.");
      setSttStatus("error");
    } finally { setTranscriptSavingId(null); }
  }

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented) return;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, button, summary, [role=dialog], dialog") || (target.closest("a") && !target.closest(".slide-lecture-link")))) return;
      if ((event.key === "f" || event.key === "F") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        toggleFullscreen();
        return;
      }
      const questionShortcut = presenterQuestionShortcut(event);
      if (event.code === "Space" && event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) event.preventDefault();
      if (questionShortcut) {
        event.preventDefault();
        if (questionShortcut === "transcript-only") {
          void dynamicRoundRef.current?.("transcript-only");
          return;
        }
        if (showJoinIntro) { next(); return; }
        setQuestionOrigin("space");
        void dynamicRoundRef.current?.();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showJoinIntro, next]);

  useEffect(() => {
    disposedRef.current = false;
    const sessionScope = sessionScopeRef.current;
    const timer = window.setInterval(() => setStatusClock(Date.now()), 5000);
    return () => {
    disposedRef.current = true;
    sessionScope.dispose();
    microphoneRequestRef.current += 1;
    window.clearInterval(timer);
    transcriptionAbortRef.current?.abort();
    autoSegmentingRef.current = false;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
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
    const stream = mediaStreamRef.current;
    const sessionScope = sessionScopeRef.current;
    const currentOperation = sessionScope.capture();
    if (!autoSegmenting || !listening || !stream || !currentOperation) return;
    const operation = currentOperation;
    const abort = new AbortController();
    transcriptionAbortRef.current = abort;
    let closing = false;
    let draining = false;
    let capture: Awaited<ReturnType<typeof startContinuousWavCapture>> | undefined;
    const queue: Array<RecordedPassage & { slideIndex: number }> = [];
    let passageSlide = slideRef.current;
    setTranscriptMessage("");
    function fail(error: unknown) {
      closing = true;
      abort.abort();
      queue.length = 0;
      void capture?.stop(false);
      if (disposedRef.current || !sessionScopeRef.current.isCurrent(operation)) return;
      stream?.getTracks().forEach(track => track.stop());
      setTranscriptPending(0);
      if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
      setListening(false); setAutoSegmenting(false);
      setSttStatus("error");
      setTranscriptMessage(`${error instanceof Error ? error.message : "Transkription fehlgeschlagen."} Aufnahme gestoppt; ausstehendes Audio wurde nicht übernommen. Mikrofon zum erneuten Versuch einschalten.`);
    }
    async function drain() {
      if (draining) return;
      draining = true;
      try {
        while (queue.length && !abort.signal.aborted) {
          const passage = queue.shift()!;
          setSttStatus("transcribing");
          const draft = await transcribeAudioBlob(passage.audio, passage.startedAt, passage.endedAt, passage.slideIndex, "auto", operation, abort.signal);
          if (draft.text.trim().length >= 8) await livePipelineRef.current?.(draft, passage.slideIndex);
          if (!disposedRef.current && sessionScopeRef.current.isCurrent(operation)) setTranscriptPending(queue.length);
        }
      } catch (error) { if (!disposedRef.current && !abort.signal.aborted) fail(error); }
      finally {
        draining = false;
        if (!disposedRef.current && sessionScopeRef.current.isCurrent(operation)) setTranscriptPending(queue.length);
      }
    }
    void startContinuousWavCapture(stream, AUTO_STT_SEGMENT_MS, passage => {
      if (abort.signal.aborted || disposedRef.current || !sessionScopeRef.current.isCurrent(operation)) return;
      if (queue.length >= MAX_QUEUED_PASSAGES) {
        fail(new Error("Der Transkriptionsdienst verarbeitet die Aufnahme zu langsam."));
        return;
      }
      queue.push({ ...passage, slideIndex: passageSlide });
      setTranscriptPending(queue.length + (draining ? 1 : 0));
      passageSlide = slideRef.current;
      void drain();
    }, fail).then(active => {
      capture = active;
      if (closing || abort.signal.aborted) void active.stop(false);
    }).catch(fail);
    return () => {
      closing = true;
      // User stop flushes the final passage; navigation aborts queued requests.
      void capture?.stop(!disposedRef.current && !abort.signal.aborted && sessionScope.isCurrent(operation));
    };
  }, [autoSegmenting, listening, transcribeAudioBlob, activeSessionId]);

  const { state: recordingState, label: recordingLabel } = transcriptRecordingStatus({
    phase: sttStatus, listening, pending: transcriptPending, lastTranscriptAt, now: statusClock
  });

  return (
    <main
      className="slide-screen presentation-screen lb-motion-root"
      onKeyDown={(event) => { if (event.key === "Escape" && controlsRef.current?.open) { controlsRef.current.open = false; controlsRef.current.querySelector("summary")?.focus(); } }}
      data-question-origin={questionOrigin}
      data-csrf-token={csrfToken}
      data-live-status={live.state?.status ?? "connecting"}
    >
      <SlideEngineCanvas
        lectureToken={lecture.publicToken}
        participationPath={lecture.participationPath}
        lectureTitle={lecture.title}
        showJoinIntro={showJoinIntro}
        joinAction={liveStatus === "ended" ? <div>
          <p role="status">Die vorherige Live-Sitzung ist beendet.</p>
          <button className="primary-button" type="button" disabled={live.busy || !live.connected} onClick={() => void live.send({ action: "start" })}>Neue Live-Sitzung starten</button>
        </div> : undefined}
        showNavigation={false}
        navigationDisabled={live.busy || !live.connected || live.state?.status !== "active"}
        current={slide}
        onNext={next}
        onPrevious={previous}
        slideDocument={lecture.slideDocument}
        slides={lecture.slides}
      />

      <button type="button" className="transcript-indicator" data-status={recordingState}
        title={recordingLabel} aria-label={recordingLabel} aria-expanded={transcriptVisible}
        onClick={() => setTranscriptVisible(current => !current)}>
        <span aria-hidden="true" />
      </button>

      <Presence show={transcriptVisible}>
        {(motionState) => (
        <aside className="transcript-panel lb-enter-overlay" data-panel-origin="transcript" data-state={motionState} aria-label="Transkriptstatus">
          <div className="overlay-head">
            <h2>Transkript</h2>
            <button type="button" aria-label="Transkript ausblenden" title="Transkript ausblenden" onClick={() => setTranscriptVisible(false)}>×</button>
          </div>
          <p className="lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
            {recordingLabel}
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
          {visibleTranscript.length > 0 ? (
            <div className="transcript-mini-list" aria-label="Bestätigtes Transkript dieser Sitzung">
              {visibleTranscript.map((segment, index) => (
                <span
                  className={`${segment.status} lb-enter-row`}
                  key={segment.id}
                  style={{ "--lb-i": index + 4 } as MotionStyle}
                >
                  {segment.text}
                </span>
              ))}
            </div>
          ) : <p>Noch kein bestätigtes Transkript in dieser Sitzung.</p>}
          <div className="transcript-actions lb-enter-row" style={{ "--lb-i": 7 } as MotionStyle}>
            <button className="plain-button" type="button" disabled={sttStatus !== "requesting" && !listening && transcriptPending > 0} onClick={listening || sttStatus === "requesting" ? stopListening : startListening}>
              {sttStatus === "requesting" ? "Freigabe abbrechen" : listening ? "Mikrofon aus" : "Mikrofon an"}
            </button>
            <button className="plain-button" disabled={!listening || sttStatus === "transcribing" || autoSegmenting || transcriptPending > 0} type="button" onClick={transcribeCurrentPassage}>
              Jetzt transkribieren
            </button>
            <button
              className="plain-button"
              disabled={!listening || (!autoSegmenting && transcriptPending > 0)}
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

      <PresenterRoundStatus state={live.state} connected={live.connected} serverOffset={live.serverOffset}
        generating={liveQuestionStatus === "generating"} message={roundMessage || live.error} leaderboardEnabled={lecture.leaderboardEnabled} />

      <StudentQuestionTicker
        lectureId={lecture.id}
        csrfToken={csrfToken}
        placement="bottom-left"
        canPublish={Boolean(activeSessionId && !showJoinIntro && live.connected && !live.busy && !questionOpen && liveQuestionStatus !== "generating")}
        onPublishDraft={publishStudentDraft}
      />

      <details className="presentation-controls" ref={controlsRef}>
      <summary aria-label="Präsentationssteuerung" title="Präsentationssteuerung öffnen">⋯</summary>
      <div className="presentation-control-panel" aria-label="Live-Werkzeuge">
      {roundMessage && <p className="form-error">{roundMessage}</p>}
      {(!live.connected || live.error || live.state?.status !== "active") && <aside className="presentation-connection-notice" role="status">
        {live.error || (!live.connected ? "Live-Verbindung wird hergestellt …" : live.state?.status === "ended" ? "Live-Sitzung beendet." : "Live-Sitzung wird vorbereitet …")}
        {live.connected && live.state?.status !== "active" && live.state?.status !== "ended" && <button type="button" disabled={live.busy} onClick={() => void live.send({ action: "start" })}>Neue Live-Sitzung starten</button>}
        {!live.connected && <button type="button" onClick={live.refresh}>Erneut verbinden</button>}
      </aside>}
      <nav className="presentation-navigation" aria-label="Foliennavigation">
        <button type="button" disabled={live.busy || !live.connected || live.state?.status !== "active"} onClick={previous} aria-label="Vorherige Folie">‹</button>
        <span>{showJoinIntro ? "Start" : `${slide + 1} / ${lecture.slides.length}`}</span>
        <button type="button" disabled={live.busy || !live.connected || live.state?.status !== "active"} onClick={next} aria-label="Nächste Folie">›</button>
        <ThemeToggle />
      </nav>
      <div className="live-controls">
        <button type="button" disabled={showJoinIntro || questionOpen || live.busy || !live.connected || liveStatus !== "active" || liveQuestionStatus === "generating"}
          onClick={() => void dynamicRoundRef.current?.()}>Neue Frage · Leertaste</button>
        <button type="button" disabled={showJoinIntro || questionOpen || live.busy || !live.connected || liveQuestionStatus === "generating"}
          aria-keyshortcuts="Shift+Space"
          onClick={() => void dynamicRoundRef.current?.("transcript-only")}>Frage aus letzter Passage · Shift+Leertaste</button>
        {questionOpen && <button type="button" disabled={live.busy} onClick={() => void sendLive({ action: "close" })}>Frage schließen</button>}
        <button className="live-back-link" type="button" disabled={live.busy} onClick={async () => {
          if (live.state?.status === "ended" || await live.send({ action: "end" })) { stopListening(); window.location.assign("/lecturer"); }
        }}>Beenden</button>
        {lecture.leaderboardEnabled && <button className="icon-action action-text" type="button" aria-expanded={leaderboardOpen} onClick={() => setLeaderboardOpen(current => !current)}>Rangliste</button>}
        {!showJoinIntro && families.length > 0 && <>
          <label>Frage<select aria-label="Fragenfamilie" value={Math.min(familyIndex, Math.max(0, families.length - 1))} onChange={(event) => setFamilyIndex(Number(event.target.value))}>
            {families.map((family, index) => <option key={family[0]?.familyId ?? index} value={index}>Frage {index + 1}</option>)}
          </select></label>
          <label>Zeit<select aria-label="Fragezeit" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
            {[5, 15, 30, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select></label>
        </>}
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
          title="Vorbereitete Frage starten oder schließen"
          aria-label="Vorbereitete Frage"
          disabled={showJoinIntro || live.busy || !live.connected || live.state?.status !== "active" || families.length === 0}
          aria-pressed={questionOpen}
          onClick={() => {
            setQuestionOrigin("control");
            toggleQuestion();
          }}
        >
          <span className="lb-icon lb-icon-question" aria-hidden="true" />
        </button>
      </div>
      </div>
      </details>

      <Presence show={lecture.leaderboardEnabled && leaderboardOpen}>{(motionState) => <LeaderboardModal entries={live.state?.leaderboard ?? []} loading={!live.connected || !live.state?.leaderboard} motionState={motionState} onClose={() => setLeaderboardOpen(false)} />}</Presence>
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
