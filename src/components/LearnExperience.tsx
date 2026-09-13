"use client";

import { questionsForSlide } from "@/lib/questions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { MAX_LEARN_QUESTION_DENSITY, MIN_LEARN_QUESTION_DENSITY, learnQuestionCadenceLabel, normalizeLearnQuestionDensity, shouldOfferLearnQuestion } from "@/lib/learn-settings";
import { seriesIdForLecture } from "@/lib/series";
import { ensureStudentEnrollment, getOrCreateStudentKey } from "@/lib/student-client";
import { animateHotspotToDrawerSharedElement } from "@/lib/motion";
import type { LeaderboardEntry, Lecture, QuestionLevel } from "@/lib/types";
import { LeaderboardModal } from "./LeaderboardModal";
import { MarkdownContent } from "./MarkdownContent";
import { Presence } from "./Presence";
import { QuizDrawer } from "./QuizDrawer";
import { SlideEngineCanvas } from "./SlideEngineCanvas";
import { ThemeToggle } from "./theme/ThemeToggle";
import "./learner-workspace.css";

const hotspotLevels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
const hotspotClasses = ["one", "two", "three", "four", "five", "six", "seven"];
type MotionStyle = CSSProperties & Record<"--lb-i", number>;
type ScreenMotionStyle = CSSProperties & Partial<Record<"--origin-x" | "--origin-y", string>>;
type QuestionOrigin = "control" | "hotspot" | "space";
type ChatSource = { sourceRef: string; excerpt: string; score?: number; retrievalMethod?: "vector" | "text" };
type ChatStreamSource = "provider" | "local" | "none";
type ChatAnswerState = "idle" | "loading" | "answered" | "error";
type ChatProviderMeta = {
  answerState: ChatAnswerState;
  provider: string;
  model: string;
  streamSource: ChatStreamSource | "";
};
type ChatJsonPayload = {
  answer?: string;
  error?: string;
  sources?: ChatSource[];
  tokenLimit?: number;
  tokensRemaining?: number;
  provider?: string;
  model?: string;
  streamSource?: ChatStreamSource;
};
type ChatStreamEvent =
  | { type: "token"; value: string }
  | {
      type: "done";
      sources?: ChatSource[];
      tokenLimit?: number;
      tokensRemaining?: number;
      provider?: string;
      model?: string;
      streamSource?: ChatStreamSource;
    }
  | { type: "error"; error: string };

const hotspotOrigins = [
  { x: "44%", y: "47%" },
  { x: "83%", y: "52%" },
  { x: "24%", y: "62%" },
  { x: "52%", y: "66%" },
  { x: "75%", y: "39%" },
  { x: "34%", y: "78%" },
  { x: "92%", y: "69%" }
];

function formatChatBudget(remaining: number, limit: number) {
  const percent = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))) : 0;
  return `KI-Kontingent heute: noch ${percent} %`;
}

export function LearnExperience({ lecture }: { lecture: Lecture }) {
  const evaluationConfig = lecture.evaluationConfig;
  const [slide, setSlide] = useState(0);
  const [density, setDensity] = useState(() => normalizeLearnQuestionDensity(lecture.learnQuestionDensity));
  const slidesSinceQuestion = useRef(0);
  const pendingNextSlide = useRef<number | null>(null);
  const offeredSlide = useRef<number | null>(null);
  function updateDensity(value: string) {
    const next = normalizeLearnQuestionDensity(value);
    setDensity(next);
    slidesSinceQuestion.current = 0;
    try { window.localStorage.setItem(`lb_learn_density_${lecture.publicToken}`, String(next)); } catch { /* Learning works without local storage. */ }
  }
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`lb_learn_density_${lecture.publicToken}`);
      if (saved !== null) setDensity(normalizeLearnQuestionDensity(saved, lecture.learnQuestionDensity));
    } catch { /* Keep the lecture default if storage is unavailable. */ }
  }, [lecture.publicToken, lecture.learnQuestionDensity]);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [questionOrigin, setQuestionOrigin] = useState<QuestionOrigin>("control");
  const [activeHotspotIndex, setActiveHotspotIndex] = useState<number | null>(null);
  const [forcedLevel, setForcedLevel] = useState<QuestionLevel | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [learningSaveState, setLearningSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [learningSaveMessage, setLearningSaveMessage] = useState("");
  useEffect(() => {
    if (learningSaveState !== "saved") return;
    const timeout = window.setTimeout(() => setLearningSaveMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [learningSaveState, learningSaveMessage]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatSources, setChatSources] = useState<ChatSource[]>([]);
  const [chatBudget, setChatBudget] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatProviderMeta, setChatProviderMeta] = useState<ChatProviderMeta>({
    answerState: "idle",
    provider: "",
    model: "",
    streamSource: ""
  });
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const [evaluationSaved, setEvaluationSaved] = useState(false);
  const [peekingSlide, setPeekingSlide] = useState(false);
  const [evaluation, setEvaluation] = useState({
    understanding: 4,
    pace: 4,
    aiHelpful: 4,
    comment: ""
  });
  const hotspotButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingHotspotSharedRef = useRef<{ index: number; level: QuestionLevel } | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);

  function closeMore() {
    if (moreRef.current) moreRef.current.open = false;
  }

  function toggleLeaderboard() {
    if (leaderboardOpen) {
      setLeaderboardOpen(false);
      return;
    }
    setQuestionOpen(false);
    setPeekingSlide(false);
    setChatOpen(false);
    setEvaluationOpen(false);
    setLeaderboardOpen(true);
    void loadLeaderboard();
  }

  function toggleEvaluation() {
    if (evaluationOpen) {
      setEvaluationOpen(false);
      return;
    }
    setQuestionOpen(false);
    setPeekingSlide(false);
    setChatOpen(false);
    setLeaderboardOpen(false);
    setEvaluationOpen(true);
  }

  const previous = useCallback(() => {
    pendingNextSlide.current = null;
    offeredSlide.current = null;
    setQuestionOpen(false);
    setPeekingSlide(false);
    setSlide((current) => (current + lecture.slides.length - 1) % lecture.slides.length);
  }, [lecture.slides.length]);

  const next = useCallback(() => {
    const nextSlide = pendingNextSlide.current ?? (slide + 1) % lecture.slides.length;
    if (pendingNextSlide.current === null && offeredSlide.current !== slide) {
      slidesSinceQuestion.current += 1;
      const hasQuestions = lecture.questions.some((question) => !question.slideId || question.slideId === lecture.slides[slide]?.id);
      if (shouldOfferLearnQuestion({ density, completedSlides: slidesSinceQuestion.current, atEnd: slide === lecture.slides.length - 1, hasQuestions })) {
        slidesSinceQuestion.current = 0;
        pendingNextSlide.current = nextSlide;
        offeredSlide.current = slide;
        closeMore();
        setChatOpen(false);
        setLeaderboardOpen(false);
        setEvaluationOpen(false);
        setPeekingSlide(false);
        setForcedLevel(null);
        setActiveHotspotIndex(null);
        setQuestionOrigin("control");
        setQuestionOpen(true);
        return;
      }
    }
    // A second explicit Next can skip the offered question. Closing the drawer
    // alone keeps the current slide; it must not create a prompt/close loop.
    pendingNextSlide.current = null;
    offeredSlide.current = null;
    setQuestionOpen(false);
    setPeekingSlide(false);
    setSlide(nextSlide);
  }, [density, lecture.questions, lecture.slides, slide]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isTyping =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof Element && Boolean(event.target.closest("button, a, summary, [contenteditable=true]")));
      if (event.code === "Space" && !isTyping) {
        event.preventDefault();
        if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
        setChatOpen(false);
        setLeaderboardOpen(false);
        setEvaluationOpen(false);
        setQuestionOrigin("space");
        setActiveHotspotIndex(null);
        if (!questionOpen) {
          slidesSinceQuestion.current = 0;
          offeredSlide.current = slide;
        }
        setQuestionOpen((current) => !current);
        closeMore();
      }
      if (event.key === "Escape") {
        if (peekingSlide) {
          event.preventDefault();
          setPeekingSlide(false);
          return;
        }
        if (chatOpen || evaluationOpen || leaderboardOpen) {
          event.preventDefault();
          setChatOpen(false);
          setEvaluationOpen(false);
          setLeaderboardOpen(false);
          closeMore();
          return;
        }
        if (moreRef.current?.open) {
          event.preventDefault();
          closeMore();
          return;
        }
        if (questionOpen) {
          event.preventDefault();
          setQuestionOpen(false);
          setPeekingSlide(false);
          closeMore();
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chatOpen, evaluationOpen, leaderboardOpen, peekingSlide, questionOpen, slide]);

  useEffect(() => {
    if (peekingSlide) closeMore();
  }, [peekingSlide]);

  useEffect(() => {
    if (!questionOpen || questionOrigin !== "hotspot" || activeHotspotIndex === null) return;
    const pending = pendingHotspotSharedRef.current;
    if (!pending || pending.index !== activeHotspotIndex) return;

    let frame = 0;
    let attempts = 0;
    const playWhenMounted = () => {
      const drawer = document.querySelector<HTMLElement>(".question-drawer");
      const source = hotspotButtonRefs.current.get(activeHotspotIndex);
      if ((!drawer || !source) && attempts < 8) {
        attempts += 1;
        frame = window.requestAnimationFrame(playWhenMounted);
        return;
      }
      const originX = hotspotOrigins[activeHotspotIndex]?.x ?? "50%";
      const originRatio = Math.max(0, Math.min(1, Number.parseFloat(originX) / 100 || 0.5));
      animateHotspotToDrawerSharedElement({
        drawer,
        level: pending.level,
        originRatio,
        source
      });
      pendingHotspotSharedRef.current = null;
    };

    frame = window.requestAnimationFrame(playWhenMounted);
    return () => window.cancelAnimationFrame(frame);
  }, [activeHotspotIndex, questionOpen, questionOrigin]);

  const questions = useMemo(() => {
    const slideQuestions = questionsForSlide(lecture.questions, lecture.slides[slide]?.id);
    if (!forcedLevel) return slideQuestions;
    return [...slideQuestions].sort((a, b) => (a.level === forcedLevel ? -1 : b.level === forcedLevel ? 1 : 0));
  }, [forcedLevel, lecture.questions, lecture.slides, slide]);
  const activeQuestion = questions[0];
  const chatStarterPrompts = useMemo(() => {
    const questionText = activeQuestion?.text ?? "die aktuelle Frage";
    return [
      {
        label: "Begriffe klären",
        message: `Erkläre die zentralen Begriffe zu dieser Frage: ${questionText}`
      },
      {
        label: "Antwort herleiten",
        message: `Hilf mir, die richtige Antwort zu dieser Frage herzuleiten, ohne nur den Buchstaben zu nennen: ${questionText}`
      },
      {
        label: "Praxisbeispiel",
        message: `Erkläre mir diese Frage mit einem Praxisbeispiel: ${questionText}`
      }
    ];
  }, [activeQuestion?.text]);
  const inspectorOpen = chatOpen || evaluationOpen || leaderboardOpen;
  const originStyle = activeHotspotIndex === null
    ? undefined
    : ({
        "--origin-x": hotspotOrigins[activeHotspotIndex]?.x ?? "50%",
        "--origin-y": hotspotOrigins[activeHotspotIndex]?.y ?? "50%"
      } as ScreenMotionStyle);

  function getAnonymousKey() {
    return getOrCreateStudentKey();
  }

  function getLearnPseudonym() {
    return window.localStorage.getItem(`lb_pseudonym_${lecture.publicToken}`)?.trim() || "Du";
  }

  async function loadLeaderboard() {
    const key = getAnonymousKey();
    setLeaderboardLoading(true);
    try {
      const response = await fetch(`/api/lecture/${lecture.publicToken}/leaderboard?anonymousKey=${encodeURIComponent(key)}`);
      const payload = (await response.json()) as { entries?: LeaderboardEntry[] };
      if (!response.ok) throw new Error("Rangliste konnte nicht geladen werden.");
      setLeaderboardEntries(Array.isArray(payload.entries) ? payload.entries : []);
      return true;
    } catch {
      setLearningSaveState("error");
      setLearningSaveMessage("Rangliste konnte nicht geladen werden. Bitte erneut öffnen.");
      return false;
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function recordLearnEvent(eventType: string, payload: Record<string, unknown>) {
    try {
      await ensureStudentEnrollment({ seriesId: seriesIdForLecture(lecture), seriesTitle: lecture.seriesTitle, lectureId: lecture.id, source: "direct_learn_link" });
    } catch (error) {
      if (eventType === "answer_selected") throw error;
      return;
    }
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lectureToken: lecture.publicToken,
        eventType,
        anonymousKey: getAnonymousKey(),
        pseudonym: getLearnPseudonym(),
        payload
      })
    }).catch((error) => {
      if (eventType === "answer_selected") throw error;
      return undefined;
    });
    if (eventType === "answer_selected" && !response?.ok) throw new Error("Antwort konnte nicht gespeichert werden.");
  }

  function toggleChat() {
    if (chatOpen) {
      setChatOpen(false);
      return;
    }
    const question = activeQuestion;
    setChatAnswer("");
    setChatSources([]);
    setChatBudget("");
    setChatMessage("");
    setChatError("");
    setChatLoading(false);
    setChatProviderMeta({
      answerState: "idle",
      provider: "",
      model: "",
      streamSource: ""
    });
    setPeekingSlide(false);
    setLeaderboardOpen(false);
    setEvaluationOpen(false);
    setChatOpen(true);
    void recordLearnEvent("ai_chat_opened", {
      mode: "learn",
      slideId: lecture.slides[slide]?.id,
      level: question?.level
    });
  }

  async function askAI(messageOverride?: string) {
    const question = activeQuestion;
    if (!question) return;
    const outgoingMessage = (messageOverride ?? chatMessage).trim();
    if (!outgoingMessage) return;

    setChatError("");
    setChatLoading(true);
    setChatAnswer("");
    setChatSources([]);
    setChatBudget("");
    setChatMessage(outgoingMessage);
    setChatProviderMeta({
      answerState: "loading",
      provider: "",
      model: "",
      streamSource: ""
    });

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lectureToken: lecture.publicToken,
          question: question.text,
          message: outgoingMessage,
          anonymousKey: getAnonymousKey(),
          pseudonym: getLearnPseudonym(),
          stream: true
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as ChatJsonPayload;
        const message = payload.error ?? "KI-Antwort konnte nicht geladen werden.";
        setChatError(message);
        setChatBudget("");
        setChatProviderMeta((current) => ({ ...current, answerState: "error" }));
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.body || !contentType.includes("application/x-ndjson")) {
        const payload = (await response.json()) as ChatJsonPayload;
        if (!payload.answer) {
          setChatError(payload.error ?? "KI-Antwort konnte nicht geladen werden.");
          setChatBudget("");
          setChatProviderMeta((current) => ({ ...current, answerState: "error" }));
          return;
        }
        setChatAnswer(payload.answer);
        setChatSources(payload.sources ?? []);
        setChatProviderMeta({
          answerState: "answered",
          provider: payload.provider ?? "",
          model: payload.model ?? "",
          streamSource: payload.streamSource ?? "none"
        });
        if (typeof payload.tokenLimit === "number" && typeof payload.tokensRemaining === "number") {
          setChatBudget(formatChatBudget(payload.tokensRemaining, payload.tokenLimit));
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedAnswer = "";
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === "token") {
            streamedAnswer += event.value;
            setChatAnswer(streamedAnswer.trim());
          }
          if (event.type === "done") {
            setChatSources(event.sources ?? []);
            if (typeof event.tokenLimit === "number" && typeof event.tokensRemaining === "number") {
              setChatBudget(formatChatBudget(event.tokensRemaining, event.tokenLimit));
            } else {
              setChatBudget("");
            }
            setChatProviderMeta({
              answerState: "answered",
              provider: event.provider ?? "",
              model: event.model ?? "",
              streamSource: event.streamSource ?? ""
            });
          }
          if (event.type === "error") {
            setChatError(event.error);
            setChatBudget("");
            setChatProviderMeta((current) => ({ ...current, answerState: "error" }));
          }
        }
      }
    } catch {
      const message = "KI-Antwort konnte nicht geladen werden.";
      setChatError(message);
      setChatBudget("");
      setChatProviderMeta((current) => ({ ...current, answerState: "error" }));
    } finally {
      setChatLoading(false);
    }
  }

  async function submitEvaluation() {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lectureToken: lecture.publicToken,
        eventType: "evaluation_submitted",
        anonymousKey: getAnonymousKey(),
        pseudonym: getLearnPseudonym(),
        payload: {
          ...evaluation,
          evaluationVersion: evaluationConfig.version,
          evaluationTitle: evaluationConfig.title,
          labels: {
            understanding: evaluationConfig.understandingLabel,
            pace: evaluationConfig.paceLabel,
            aiHelpful: evaluationConfig.aiHelpfulLabel,
            comment: evaluationConfig.commentLabel
          }
        }
      })
    });

    if (response.ok) {
      setEvaluationSaved(true);
    }
  }

  return (
    <main
      className={`slide-screen learn-shell lb-motion-root ${questionOpen ? "question-open" : ""} ${peekingSlide ? "slide-peek" : ""} ${inspectorOpen ? "inspector-open" : ""}`}
      data-question-origin={questionOrigin}
      style={originStyle}
    >
      {learningSaveMessage && <p className="learn-save-status" role="status" data-state={learningSaveState}>{learningSaveMessage}</p>}
      <SlideEngineCanvas
        mobileReading
        lectureToken={lecture.publicToken}
        participationPath={lecture.participationPath}
        lectureTitle={lecture.title}
        current={slide}
        onNext={next}
        onPrevious={previous}
        showNavigation={false}
        slideDocument={lecture.slideDocument}
        slides={lecture.slides}
      />
      {questionOpen && questionOrigin === "hotspot" && <span className="question-origin-trace" aria-hidden="true" />}
      <div className="learner-workspace-toolbar lb-enter-control" role="group" aria-label="Lernsteuerung">
        <nav className="learner-slide-navigation" aria-label="Foliennavigation">
          <button type="button" onClick={previous} aria-label="Vorherige Folie" title="Vorherige Folie">‹</button>
          <span className="learner-slide-count slide-count" aria-live="polite" aria-atomic="true">{slide + 1} / {lecture.slides.length}</span>
          <button type="button" onClick={next} aria-label="Nächste Folie" title="Nächste Folie">›</button>
        </nav>
        <button
          className="learner-question-toggle"
          type="button"
          title="Quiz (Leertaste)"
          aria-label="Quiz (Leertaste)"
          aria-pressed={questionOpen}
          onClick={() => {
            closeMore();
            setChatOpen(false);
            setLeaderboardOpen(false);
            setEvaluationOpen(false);
            setQuestionOrigin("control");
            setActiveHotspotIndex(null);
            if (!questionOpen) {
              slidesSinceQuestion.current = 0;
              offeredSlide.current = slide;
            }
            setQuestionOpen((current) => {
              if (current) setPeekingSlide(false);
              return !current;
            });
          }}
        >
          <span className="lb-icon lb-icon-question" aria-hidden="true" />
        </button>
        <details ref={moreRef} className="learn-more learner-control-menu">
          <summary aria-label="Weitere Aktionen">Mehr</summary>
          <div className="learn-more-panel learner-control-menu-panel" role="group" aria-label="Weitere Aktionen">
      <div className="hotspots" aria-label="Fragen-Hotspots">
        <span className="hotspot-row-label">Fragen</span>
        {hotspotLevels.map((level, index) => (
          <button
            className={`hotspot lb-enter-hotspot ${hotspotClasses[index]}`}
            key={`${level}-${index}`}
            type="button"
            ref={(node) => {
              if (node) {
                hotspotButtonRefs.current.set(index, node);
              } else {
                hotspotButtonRefs.current.delete(index);
              }
            }}
            style={{ "--lb-i": index } as MotionStyle}
            aria-pressed={questionOpen && activeHotspotIndex === index}
            aria-label={`Frage Niveau ${level} anzeigen`}
            onClick={() => {
              closeMore();
              if (questionOpen && activeHotspotIndex === index) {
                setQuestionOpen(false);
                setPeekingSlide(false);
                return;
              }
              pendingHotspotSharedRef.current = { index, level };
              slidesSinceQuestion.current = 0;
              offeredSlide.current = slide;
              setChatOpen(false);
              setLeaderboardOpen(false);
              setEvaluationOpen(false);
              setForcedLevel(level);
              setQuestionOrigin("hotspot");
              setActiveHotspotIndex(index);
              setQuestionOpen(true);
              void recordLearnEvent("learn_marker_opened", { mode: "learn", level, slideId: lecture.slides[slide]?.id });
            }}
          >
            <span className="hotspot-level" aria-hidden="true">{level}</span>
          </button>
        ))}
      </div>
            <label className="learner-density-control">
              <span>Fragedichte</span>
              <input
                aria-label="Fragedichte"
                type="range"
                min={MIN_LEARN_QUESTION_DENSITY}
                max={MAX_LEARN_QUESTION_DENSITY}
                value={density}
                aria-valuetext={learnQuestionCadenceLabel(density)}
                onChange={(event) => updateDensity(event.currentTarget.value)}
                onInput={(event) => updateDensity(event.currentTarget.value)}
              />
              <output aria-live="polite">{learnQuestionCadenceLabel(density)}</output>
            </label>
            {activeQuestion && (
              <button
                className="plain-button small"
                type="button"
                aria-controls="learner-chat-panel"
                aria-pressed={chatOpen}
                onClick={toggleChat}
              >
                KI fragen
              </button>
            )}
            <a
              className="plain-button small"
              href={`/api/lecture/${lecture.publicToken}/export`}
              download
              onClick={() => void recordLearnEvent("standalone_export_downloaded", { mode: "learn" })}
            >
              Lern-HTML herunterladen
            </a>
            {lecture.leaderboardEnabled && (
              <button
                className="plain-button small"
                type="button"
                aria-controls="learner-leaderboard-panel"
                aria-pressed={leaderboardOpen}
                onClick={toggleLeaderboard}
              >
                Rangliste
              </button>
            )}
            {evaluationConfig.enabled && (
              <button
                className="plain-button small"
                type="button"
                aria-controls="learner-evaluation-panel"
                aria-pressed={evaluationOpen}
                onClick={toggleEvaluation}
              >
                {evaluationConfig.title}
              </button>
            )}
            <ThemeToggle className="learner-menu-theme" />
          </div>
        </details>
      </div>
      <Presence show={questionOpen}>
        {(motionState) => (
          <QuizDrawer
            key={lecture.slides[slide]?.id}
            questions={questions}
            initialLevel={forcedLevel ?? "2.0"}
            origin={questionOrigin}
            motionState={motionState}
            mode="learn"
            peeking={peekingSlide}
            onPeekSlide={() => {
              closeMore();
              setPeekingSlide(true);
            }}
            onContinue={() => {
              setQuestionOpen(false);
              setPeekingSlide(false);
              const destination = pendingNextSlide.current;
              pendingNextSlide.current = null;
              if (destination !== null) {
                offeredSlide.current = null;
                setSlide(destination);
              }
            }}
            headerAction={(
              <button
                className="plain-button question-ai-link lb-enter-control"
                type="button"
                aria-controls="learner-chat-panel"
                aria-pressed={chatOpen}
                onClick={toggleChat}
              >
                KI fragen
              </button>
            )}
            onAnswered={({ question, correct, selected }) => {
              const selectedAnswer = question.answers.find((answer) => answer.key === selected);
              const correctAnswer = question.answers.find((answer) => answer.correct);
              void (async () => {
                setLearningSaveState("saving");
                setLearningSaveMessage("Antwort wird gespeichert …");
                try {
                await recordLearnEvent("answer_selected", {
                  mode: "learn",
                  level: question.level,
                  familyId: question.familyId,
                  slideId: question.slideId,
                  points: question.points,
                  questionText: question.text,
                  selected,
                  selectedAnswerKey: selected,
                  selectedAnswerText: selectedAnswer?.text,
                  correctAnswerKey: correctAnswer?.key,
                  correctAnswerText: correctAnswer?.text,
                  correct
                });
                setLearningSaveState("saved");
                setLearningSaveMessage("Antwort gespeichert");
                if (lecture.leaderboardEnabled && await loadLeaderboard()) setLearningSaveMessage("Antwort gespeichert · Rangliste aktualisiert");
                } catch {
                  setLearningSaveState("error");
                  setLearningSaveMessage("Speichern nicht bestätigt. Bitte Verbindung und Rangliste prüfen, bevor du erneut antwortest.");
                }
              })();
            }}
          />
        )}
      </Presence>
      {peekingSlide && questionOpen && (
        <button autoFocus className="plain-button slide-peek-return island-control" type="button" onClick={() => setPeekingSlide(false)}>
          Zurück zur Frage
        </button>
      )}
      <Presence show={lecture.leaderboardEnabled && leaderboardOpen}>
        {(motionState) => (
          <LeaderboardModal
            entries={leaderboardEntries}
            loading={leaderboardLoading}
            motionState={motionState}
            onClose={() => setLeaderboardOpen(false)}
          />
        )}
      </Presence>
      <Presence show={chatOpen}>
        {(motionState) => (
        <aside
          className="overlay-panel tall lb-enter-overlay"
          id="learner-chat-panel"
          data-panel-origin="chat"
          data-state={motionState}
          data-ai-answer-state={chatProviderMeta.answerState}
          data-ai-provider={chatProviderMeta.provider || undefined}
          data-ai-model={chatProviderMeta.model || undefined}
          data-ai-stream-source={chatProviderMeta.streamSource || undefined}
          aria-label="KI Chat"
        >
          <div className="overlay-head">
            <h2 id="learner-chat-panel-title">KI-Assistent</h2>
            <button type="button" onClick={() => setChatOpen(false)} aria-label="Chat schließen" title="Schließen">×</button>
          </div>
          <div className="chat-body">
            {activeQuestion?.text && (
              <div className="chat-message lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
                <span>{activeQuestion.text}</span>
              </div>
            )}
            <div className="chat-message lb-enter-row" style={{ "--lb-i": 1 } as MotionStyle}>
              <div aria-live="polite">
                {chatAnswer ? (
                  <MarkdownContent content={chatAnswer} />
                ) : (
                  <span>{chatLoading ? "Antwort wird geladen …" : "Was möchtest du zuerst klären?"}</span>
                )}
              </div>
              {!chatLoading && !chatAnswer && (
                <div className="chat-starter-actions" aria-label="Startfragen">
                  {chatStarterPrompts.map((prompt) => (
                    <button
                      className="plain-button"
                      key={prompt.label}
                      type="button"
                      onClick={() => void askAI(prompt.message)}
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {chatSources.length > 0 && (
              <div className="chat-message source-message lb-enter-row" style={{ "--lb-i": 2 } as MotionStyle}>
                <strong>Quellen</strong>
                {chatSources.map((source, index) => (
                  <span className="lb-enter-row" key={`${source.sourceRef}-${index}`} style={{ "--lb-i": index } as MotionStyle}>
                    {source.sourceRef}: {source.excerpt}
                  </span>
                ))}
              </div>
            )}
            {chatBudget && <p className="form-note" aria-live="polite">{chatBudget}</p>}
            {chatError && <p role="alert" className="form-error">{chatError}</p>}
          </div>
          <div className="chat-input">
            <input
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              aria-label="Eigene Frage"
              placeholder="Eigene Frage"
              suppressHydrationWarning
            />
            <button className="primary-button" type="button" onClick={() => void askAI()} disabled={chatLoading || !chatMessage.trim()}>
              {chatLoading ? "Sendet …" : "Fragen"}
            </button>
          </div>
        </aside>
        )}
      </Presence>
      <Presence show={evaluationOpen && evaluationConfig.enabled}>
        {(motionState) => (
        <aside className="overlay-panel tall evaluation-panel lb-enter-overlay" id="learner-evaluation-panel" data-panel-origin="evaluation" data-state={motionState} aria-label="Evaluation">
          <div className="overlay-head">
            <h2 id="learner-evaluation-panel-title">{evaluationConfig.title}</h2>
            <button type="button" onClick={() => setEvaluationOpen(false)} aria-label="Evaluation schließen" title="Schließen">×</button>
          </div>
          <p className="form-note lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>{evaluationConfig.intro}</p>
          <div className="evaluation-body">
            <label className="lb-enter-row" style={{ "--lb-i": 1 } as MotionStyle}>
              {evaluationConfig.understandingLabel}
              <input
                aria-label="Verständnis bewerten"
                type="range"
                min="1"
                max="5"
                value={evaluation.understanding}
                onChange={(event) => setEvaluation((current) => ({ ...current, understanding: Number(event.target.value) }))}
              />
              <strong>{evaluation.understanding}/5</strong>
            </label>
            <label className="lb-enter-row" style={{ "--lb-i": 2 } as MotionStyle}>
              {evaluationConfig.paceLabel}
              <input
                aria-label="Tempo bewerten"
                type="range"
                min="1"
                max="5"
                value={evaluation.pace}
                onChange={(event) => setEvaluation((current) => ({ ...current, pace: Number(event.target.value) }))}
              />
              <strong>{evaluation.pace}/5</strong>
            </label>
            <label className="lb-enter-row" style={{ "--lb-i": 3 } as MotionStyle}>
              {evaluationConfig.aiHelpfulLabel}
              <input
                aria-label="KI-Hilfe bewerten"
                type="range"
                min="1"
                max="5"
                value={evaluation.aiHelpful}
                onChange={(event) => setEvaluation((current) => ({ ...current, aiHelpful: Number(event.target.value) }))}
              />
              <strong>{evaluation.aiHelpful}/5</strong>
            </label>
            <label className="lb-enter-row" style={{ "--lb-i": 4 } as MotionStyle}>
              {evaluationConfig.commentLabel}
              <textarea
                aria-label="Evaluationskommentar"
                value={evaluation.comment}
                onChange={(event) => setEvaluation((current) => ({ ...current, comment: event.target.value }))}
                rows={4}
                suppressHydrationWarning
              />
            </label>
          </div>
          <button className="primary-button" type="button" onClick={submitEvaluation}>{evaluationConfig.submitLabel}</button>
          {evaluationSaved && <p className="form-note">Gespeichert.</p>}
        </aside>
        )}
      </Presence>
    </main>
  );
}
