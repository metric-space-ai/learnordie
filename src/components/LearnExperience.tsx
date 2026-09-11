"use client";

import { questionsForSlide } from "@/lib/questions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { normalizeLearnQuestionDensity } from "@/lib/learn-settings";
import { animateHotspotToDrawerSharedElement } from "@/lib/motion";
import type { LeaderboardEntry, Lecture, QuestionLevel } from "@/lib/types";
import { LeaderboardModal } from "./LeaderboardModal";
import { MarkdownContent } from "./MarkdownContent";
import { Presence } from "./Presence";
import { QuizDrawer } from "./QuizDrawer";
import { SlideEngineCanvas } from "./SlideEngineCanvas";

const hotspotLevels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0", "3.0", "2.0", "1.0"];
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
  // Die Fragedichte legt die Lehrperson im Studio fest; Studierende sehen nur die Hotspots.
  const density = normalizeLearnQuestionDensity(lecture.learnQuestionDensity);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [questionOrigin, setQuestionOrigin] = useState<QuestionOrigin>("control");
  const [activeHotspotIndex, setActiveHotspotIndex] = useState<number | null>(null);
  const [forcedLevel, setForcedLevel] = useState<QuestionLevel | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
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
  const [evaluation, setEvaluation] = useState({
    understanding: 4,
    pace: 4,
    aiHelpful: 4,
    comment: ""
  });
  const hotspotButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingHotspotSharedRef = useRef<{ index: number; level: QuestionLevel } | null>(null);

  const previous = useCallback(() => setSlide((current) => (current + lecture.slides.length - 1) % lecture.slides.length), [lecture.slides.length]);
  const next = useCallback(() => setSlide((current) => (current + 1) % lecture.slides.length), [lecture.slides.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isTyping =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if (event.code === "Space" && !isTyping) {
        event.preventDefault();
        setQuestionOrigin("space");
        setActiveHotspotIndex(null);
        setQuestionOpen((current) => !current);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
    // Prefer the browser-wide student key so answers link to the student profile
    // and feed readiness. Anonymous visitors keep a per-browser learn key.
    const studentKey = window.localStorage.getItem("lb_student_key");
    if (studentKey) return studentKey;
    const key = "learnbuddy_anonymous_key";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = `learn_${crypto.randomUUID()}`;
    window.localStorage.setItem(key, created);
    return created;
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
      setLeaderboardEntries(Array.isArray(payload.entries) ? payload.entries : []);
    } catch {
      setLeaderboardEntries([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function recordLearnEvent(eventType: string, payload: Record<string, unknown>) {
    await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lectureToken: lecture.publicToken,
        eventType,
        anonymousKey: getAnonymousKey(),
        pseudonym: getLearnPseudonym(),
        payload
      })
    }).catch(() => {
      // Analytics must never block the learning flow.
    });
  }

  function openChat() {
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
      className={`slide-screen lb-motion-root ${questionOpen ? "question-open" : ""} ${inspectorOpen ? "inspector-open" : ""}`}
      data-question-origin={questionOrigin}
      style={originStyle}
    >
      <SlideEngineCanvas
        current={slide}
        onNext={next}
        onPrevious={previous}
        slideDocument={lecture.slideDocument}
        slides={lecture.slides}
      />
      {questionOpen && questionOrigin === "hotspot" && <span className="question-origin-trace" aria-hidden="true" />}
      <div className="hotspots" aria-label="Fragen-Hotspots">
        {hotspotLevels.slice(0, density).map((level, index) => (
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
              pendingHotspotSharedRef.current = { index, level };
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
      <div className="learn-bar lb-enter-control">
        <a
          className="learn-export-link"
          href={`/api/lecture/${lecture.publicToken}/export`}
          download
          onClick={() => void recordLearnEvent("standalone_export_downloaded", { mode: "learn" })}
        >
          Herunterladen
        </a>
      </div>
      <div className="action-stack lb-enter-control">
        <button
          className="icon-action"
          type="button"
          title="Quiz (Leertaste)"
          aria-label="Quiz (Leertaste)"
          aria-pressed={questionOpen}
          onClick={() => {
            setQuestionOrigin("control");
            setActiveHotspotIndex(null);
            setQuestionOpen((current) => !current);
          }}
        >
          <span className="lb-icon lb-icon-question" aria-hidden="true" />
        </button>
        {lecture.leaderboardEnabled && (
          <button
            className="icon-action action-text"
            type="button"
            onClick={() => {
              setLeaderboardOpen(true);
              void loadLeaderboard();
            }}
          >
            Rangliste
          </button>
        )}
        {evaluationConfig.enabled && (
          <button className="icon-action action-text" type="button" onClick={() => setEvaluationOpen(true)}>
            Feedback
          </button>
        )}
      </div>
      <Presence show={questionOpen}>
        {(motionState) => (
          <QuizDrawer
            key={lecture.slides[slide]?.id}
            questions={questions}
            initialLevel={forcedLevel ?? "2.0"}
            origin={questionOrigin}
            motionState={motionState}
            headerAction={(
              <button className="plain-button question-ai-link lb-enter-control" type="button" onClick={openChat}>
                KI fragen
              </button>
            )}
            onAnswered={({ question, correct, selected }) => {
              const selectedAnswer = question.answers.find((answer) => answer.key === selected);
              const correctAnswer = question.answers.find((answer) => answer.correct);
              void (async () => {
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
                await loadLeaderboard();
              })();
            }}
            onExpired={() => setQuestionOpen(false)}
          />
        )}
      </Presence>
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
          data-panel-origin="chat"
          data-state={motionState}
          data-ai-answer-state={chatProviderMeta.answerState}
          data-ai-provider={chatProviderMeta.provider || undefined}
          data-ai-model={chatProviderMeta.model || undefined}
          data-ai-stream-source={chatProviderMeta.streamSource || undefined}
          aria-label="KI Chat"
        >
          <div className="overlay-head">
            <h2>KI-Assistent</h2>
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
        <aside className="overlay-panel tall evaluation-panel lb-enter-overlay" data-panel-origin="evaluation" data-state={motionState} aria-label="Evaluation">
          <div className="overlay-head">
            <h2>{evaluationConfig.title}</h2>
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
