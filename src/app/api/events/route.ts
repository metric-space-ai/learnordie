import { NextResponse } from "next/server";
import { z } from "zod";

import type { Lecture, QuestionLevel } from "@/lib/types";
import { getAnalyticsRepository } from "@/server/analytics-repository";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";

const MAX_PUBLIC_EVENT_BYTES = 16_384;
const questionLevels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
const publicEventTypes = ["student_joined", "answer_selected", "evaluation_submitted", "ai_chat_opened", "learn_marker_opened", "standalone_export_downloaded"] as const;

const schema = z.object({
  lectureToken: z.string().trim().refine(isValidPublicLectureToken),
  eventType: z.enum(publicEventTypes),
  payload: z.record(z.string(), z.unknown()).default({}),
  anonymousKey: z.string().min(8).max(160),
  pseudonym: z.string().min(1).max(80).optional()
});

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function mode(value: unknown) {
  const normalized = text(value, 16);
  return normalized === "learn" || normalized === "live" ? normalized : "live";
}

function rating(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 3;
  return Math.min(5, Math.max(1, Math.round(numberValue)));
}

function level(value: unknown): QuestionLevel | undefined {
  return typeof value === "string" && questionLevels.includes(value as QuestionLevel)
    ? (value as QuestionLevel)
    : undefined;
}

function answerKey(value: unknown) {
  const normalized = text(value, 1).toUpperCase();
  return ["A", "B", "C", "D"].includes(normalized) ? normalized : "";
}

function labelMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const labels = value as Record<string, unknown>;
  return {
    understanding: text(labels.understanding, 120),
    pace: text(labels.pace, 120),
    aiHelpful: text(labels.aiHelpful, 120),
    comment: text(labels.comment, 120)
  };
}

function sanitizeAnswerSelectedPayload(lecture: Lecture, payload: Record<string, unknown>) {
  const selectedLevel = level(payload.level);
  if (!selectedLevel) return { error: "Ungültiges Frageniveau." };

  const question = lecture.questions.find((candidate) => candidate.level === selectedLevel);
  if (!question) return { error: "Frage nicht gefunden." };

  const selectedKey = answerKey(payload.selectedAnswerKey) || answerKey(payload.selected);
  if (!selectedKey) return { error: "Ungültige Antwortauswahl." };

  const selectedAnswer = question.answers.find((answer) => answer.key === selectedKey);
  const correctAnswer = question.answers.find((answer) => answer.correct);
  if (!selectedAnswer || !correctAnswer) return { error: "Antwort nicht gefunden." };

  const correct = selectedAnswer.correct === true;
  return {
    payload: {
      mode: mode(payload.mode),
      level: question.level,
      points: question.points,
      earnedPoints: correct ? question.points : 0,
      questionText: question.text,
      selected: selectedAnswer.key,
      selectedAnswerKey: selectedAnswer.key,
      selectedAnswerText: selectedAnswer.text,
      correctAnswerKey: correctAnswer.key,
      correctAnswerText: correctAnswer.text,
      correct
    }
  };
}

function sanitizeEvaluationPayload(lecture: Lecture, payload: Record<string, unknown>) {
  const config = lecture.evaluationConfig;
  if (!config.enabled) return { error: "Evaluation ist für diese Vorlesung nicht aktiv." };

  return {
    payload: {
      understanding: rating(payload.understanding),
      pace: rating(payload.pace),
      aiHelpful: rating(payload.aiHelpful),
      comment: text(payload.comment, 1200),
      evaluationVersion: config.version,
      evaluationTitle: config.title,
      labels: {
        ...labelMap(payload.labels),
        understanding: config.understandingLabel,
        pace: config.paceLabel,
        aiHelpful: config.aiHelpfulLabel,
        comment: config.commentLabel
      }
    }
  };
}

function sanitizePublicPayload(lecture: Lecture, eventType: (typeof publicEventTypes)[number], payload: Record<string, unknown>) {
  if (eventType === "answer_selected") return sanitizeAnswerSelectedPayload(lecture, payload);
  if (eventType === "evaluation_submitted") return sanitizeEvaluationPayload(lecture, payload);
  if (eventType === "ai_chat_opened" || eventType === "learn_marker_opened") {
    const slideId = text(payload.slideId, 80);
    const selectedLevel = level(payload.level);
    return {
      payload: {
        mode: mode(payload.mode),
        ...(slideId && lecture.slides.some((slide) => slide.id === slideId) ? { slideId } : {}),
        ...(selectedLevel ? { level: selectedLevel } : {})
      }
    };
  }

  return {
    payload: {
      mode: mode(payload.mode)
    }
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_PUBLIC_EVENT_BYTES) {
    return NextResponse.json({ error: "Event ist zu groß." }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ungültiges Event." }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Event." }, { status: 400 });
  }

  const lecture = await getLectureRepository().getLectureByToken(parsed.data.lectureToken);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const sanitized = sanitizePublicPayload(lecture, parsed.data.eventType, parsed.data.payload);
  if ("error" in sanitized) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const result = await getAnalyticsRepository().recordEvent({
    ...parsed.data,
    payload: sanitized.payload
  });
  if (!result) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  return NextResponse.json({ ok: true, count: result.count, event: result.event });
}

export async function GET() {
  return NextResponse.json({ error: "Analytics-Events sind nicht öffentlich abrufbar." }, { status: 405 });
}
