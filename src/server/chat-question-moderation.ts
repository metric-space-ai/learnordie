import type { Lecture, StudentChatQuestionStatus } from "@/lib/types";
import { evaluateStudentChatQuestion } from "./chat-question-filter";
import { getAIProvider } from "./providers/ai";

export type ChatQuestionModerationDecision = {
  status: StudentChatQuestionStatus;
  reason: string;
  sourceTopic?: string;
  provider: string;
  model: string;
  confidence: number;
  signals: string[];
};

function uniqueSignals(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 6);
}

function selectedChatModerationProvider() {
  return (process.env.LEARNBUDDY_CHAT_MODERATION_PROVIDER ?? "local").trim().toLowerCase();
}

function wantsAIChatModeration() {
  return ["ai", "llm", "external", "provider", "ctox", "ctox-responses", "openai-compatible", "http"].includes(selectedChatModerationProvider());
}

function localModerationDecision(lecture: Lecture, text: string): ChatQuestionModerationDecision {
  const relevance = evaluateStudentChatQuestion(lecture, text);
  const matchedSignals = uniqueSignals([
    ...(relevance.matches ?? []),
    relevance.sourceTopic ?? "",
    lecture.title
  ]);
  const confidence = relevance.status === "accepted"
    ? Math.min(96, 68 + matchedSignals.length * 7)
    : relevance.reason.startsWith("Zu kurz")
      ? 91
      : 84;

  return {
    status: relevance.status,
    reason: `KI-Moderation: ${relevance.reason}`,
    sourceTopic: relevance.sourceTopic,
    provider: "learnbuddy-chat-moderator",
    model: "local-rubric-v1",
    confidence,
    signals: relevance.status === "accepted" ? matchedSignals : uniqueSignals([relevance.reason])
  };
}

function moderationContext(lecture: Lecture) {
  const slideContext = lecture.slides
    .slice(0, 6)
    .map((slide, index) => [
      `Folie ${index + 1}: ${slide.title}`,
      `Thema: ${slide.topic}`,
      `Inhalt: ${slide.copy.join(" ")}`
    ].join("\n"))
    .join("\n\n");
  const questionContext = lecture.questions
    .slice(0, 6)
    .map((question) => `Niveau ${question.level}: ${question.text}`)
    .join("\n");

  return [
    `Vorlesungsreihe: ${lecture.seriesTitle}`,
    `Vorlesung: ${lecture.title}`,
    "Folienkontext:",
    slideContext,
    "Aktive Fragen:",
    questionContext
  ].join("\n");
}

function moderationSystemPrompt() {
  return [
    "LEARNBUDDY_CHAT_QUESTION_MODERATION_V1",
    "Du moderierst Chatfragen in einer technischen Hochschulvorlesung.",
    "Entscheide, ob die Frage fachlich zur aktuellen Vorlesung passt und als Quelle für Quizfragen genutzt werden darf.",
    "Ignoriere Organisatorisches, Off-Topic, Smalltalk, Namen, private Anliegen und nicht zielfuehrende Fragen.",
    "Antworte ausschliesslich als JSON-Objekt mit den Feldern:",
    '{"status":"accepted|ignored","reason":"kurze deutsche Begruendung","sourceTopic":"optionales Thema","confidence":0-100,"signals":["maximal sechs kurze Signale"]}'
  ].join("\n");
}

function moderationUserPrompt(lecture: Lecture, text: string, localDecision: ChatQuestionModerationDecision) {
  return [
    moderationContext(lecture),
    "",
    `Lokale Heuristik: ${localDecision.status}; ${localDecision.reason}; Signale: ${localDecision.signals.join(", ") || "keine"}`,
    "",
    `Studierendenfrage: ${text}`
  ].join("\n");
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? "";
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function statusValue(value: unknown, fallback: StudentChatQuestionStatus): StudentChatQuestionStatus {
  return value === "accepted" || value === "ignored" ? value : fallback;
}

function confidenceValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function signalValues(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return uniqueSignals(fallback);
  return uniqueSignals(value.filter((item): item is string => typeof item === "string"));
}

function parseProviderDecision(
  answer: string,
  fallback: ChatQuestionModerationDecision,
  provider: string,
  model: string
): ChatQuestionModerationDecision {
  const json = extractJsonObject(answer);
  if (!json) throw new Error("Chat moderation provider returned no JSON object.");
  const payload = JSON.parse(json) as Record<string, unknown>;
  const status = statusValue(payload.status, fallback.status);
  const reason = stringValue(payload.reason, fallback.reason.replace(/^KI-Moderation:\s*/i, ""));
  const sourceTopic = stringValue(payload.sourceTopic, fallback.sourceTopic);
  const signals = signalValues(payload.signals, fallback.signals);

  return {
    status,
    reason: `KI-Moderation: ${reason}`,
    sourceTopic: sourceTopic || undefined,
    provider,
    model,
    confidence: confidenceValue(payload.confidence, fallback.confidence),
    signals: signals.length > 0 ? signals : fallback.signals
  };
}

export async function moderateStudentChatQuestion(lecture: Lecture, text: string): Promise<ChatQuestionModerationDecision> {
  const localDecision = localModerationDecision(lecture, text);
  if (!wantsAIChatModeration()) return localDecision;

  if (text.replace(/\s+/g, " ").trim().length < 12) {
    return {
      ...localDecision,
      signals: uniqueSignals([...localDecision.signals, "provider übersprungen: zu kurz"])
    };
  }

  try {
    const provider = getAIProvider();
    const result = await provider.complete({
      system: moderationSystemPrompt(),
      user: moderationUserPrompt(lecture, text, localDecision),
      maxOutputTokens: 260,
      temperature: 0,
      responseFormat: "json_object"
    });
    return parseProviderDecision(
      result.answer,
      localDecision,
      provider.info.provider,
      provider.info.model
    );
  } catch {
    return {
      ...localDecision,
      signals: uniqueSignals([...localDecision.signals, "provider fallback"])
    };
  }
}
