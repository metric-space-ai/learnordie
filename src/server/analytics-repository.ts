import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, inArray } from "drizzle-orm";

import type {
  AnalyticsImprovementDiffField,
  AnalyticsImprovementSuggestionItem,
  AnalyticsSeriesTrendItem,
  LeaderboardEntry,
  LectureAnalyticsSummary,
  QuestionLevel
} from "@/lib/types";
import { estimateAiCost } from "./ai-cost";
import { getDb } from "./db/client";
import { analyticsEvents, lectureSeries, lectures, participantSessions, studentChatQuestions } from "./db/schema";

const LOCAL_ANALYTICS_PATH = path.join(process.cwd(), ".data", "learnbuddy-events.json");

export type AnalyticsEventInput = {
  lectureToken?: string;
  eventType: string;
  payload: Record<string, unknown>;
  anonymousKey?: string;
  pseudonym?: string;
};

export type AnalyticsEventRecord = {
  id: string;
  lectureToken?: string;
  eventType: string;
  payload: Record<string, unknown>;
  anonymousKey?: string;
  pseudonym?: string;
  occurredAt: string;
};

type ChatQuestionClusterSignal = {
  text: string;
  status: "accepted" | "ignored";
  pseudonym: string;
  relevanceReason: string;
  sourceTopic?: string;
  createdAt: string;
};

export interface AnalyticsRepository {
  recordEvent(input: AnalyticsEventInput): Promise<{ event: AnalyticsEventRecord; count: number } | null>;
  listEvents(): Promise<AnalyticsEventRecord[]>;
  getLectureSummary(input: { lectureId: string; lectureToken: string; seriesTitle?: string }): Promise<LectureAnalyticsSummary>;
  getLectureLeaderboard(input: { lectureId: string; lectureToken: string; currentAnonymousKey?: string }): Promise<LeaderboardEntry[]>;
}

type LocalAnalyticsData = {
  events: AnalyticsEventRecord[];
};

async function ensureLocalAnalyticsStore() {
  await fs.mkdir(path.dirname(LOCAL_ANALYTICS_PATH), { recursive: true });
  try {
    await fs.access(LOCAL_ANALYTICS_PATH);
  } catch {
    await writeLocalAnalyticsStore({ events: [] });
  }
}

async function readLocalAnalyticsStore() {
  await ensureLocalAnalyticsStore();
  return JSON.parse(await fs.readFile(LOCAL_ANALYTICS_PATH, "utf8")) as LocalAnalyticsData;
}

async function writeLocalAnalyticsStore(data: LocalAnalyticsData) {
  const tmp = `${LOCAL_ANALYTICS_PATH}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, LOCAL_ANALYTICS_PATH);
}

const levels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
const levelPoints: Record<QuestionLevel, number> = {
  "4.0": 1,
  "3.0": 2,
  "2.0": 3,
  "1.0": 4
};

function rate(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function numericRating(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(5, Math.max(1, Math.round(numberValue)));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function textPayload(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function levelPayload(value: unknown): QuestionLevel | undefined {
  if (typeof value !== "string") return undefined;
  return levels.includes(value as QuestionLevel) ? (value as QuestionLevel) : undefined;
}

function scoreFromAnswerPayload(payload: Record<string, unknown>) {
  if (payload.correct !== true) return 0;

  const points = Number(payload.points);
  if (Number.isFinite(points) && points >= 1 && points <= 4) return Math.round(points);

  const level = levelPayload(payload.level);
  return level ? levelPoints[level] : 1;
}

function safeLeaderboardName(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 40);
}

function buildLeaderboardEntries(events: AnalyticsEventRecord[], currentAnonymousKey?: string): LeaderboardEntry[] {
  const totals = new Map<string, { anonymousKey: string; name: string; points: number; correct: number; answers: number; lastAt: string }>();

  for (const event of events) {
    if (event.eventType !== "answer_selected") continue;
    const anonymousKey = event.anonymousKey ?? `event:${event.id}`;
    const existing = totals.get(anonymousKey) ?? {
      anonymousKey,
      name: safeLeaderboardName(event.pseudonym, "Pseudonym"),
      points: 0,
      correct: 0,
      answers: 0,
      lastAt: event.occurredAt
    };

    existing.name = safeLeaderboardName(event.pseudonym, existing.name);
    existing.points += scoreFromAnswerPayload(event.payload);
    existing.correct += event.payload.correct === true ? 1 : 0;
    existing.answers += 1;
    if (event.occurredAt > existing.lastAt) existing.lastAt = event.occurredAt;
    totals.set(anonymousKey, existing);
  }

  const ranked = [...totals.values()]
    .sort((left, right) =>
      right.points - left.points ||
      right.correct - left.correct ||
      left.answers - right.answers ||
      left.lastAt.localeCompare(right.lastAt) ||
      left.name.localeCompare(right.name)
    )
    .map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      points: entry.points,
      correct: entry.correct,
      answers: entry.answers,
      self: Boolean(currentAnonymousKey && entry.anonymousKey === currentAnonymousKey)
    }));

  const topEntries = ranked.slice(0, 10);
  const currentEntry = currentAnonymousKey ? ranked.find((entry) => entry.self) : undefined;
  if (currentEntry && !topEntries.some((entry) => entry.self)) {
    return [...topEntries, currentEntry];
  }

  return topEntries;
}

function timelineBucketStart(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setSeconds(0, 0);
  return date.toISOString();
}

function formatTimelineLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildActivityTimelineSummary(events: AnalyticsEventRecord[]): LectureAnalyticsSummary["activityTimeline"] {
  const grouped = new Map<
    string,
    {
      startAt: string;
      events: number;
      participantKeys: Set<string>;
      answers: number;
      correct: number;
      aiQuestions: number;
      evaluations: number;
    }
  >();

  for (const event of events) {
    const startAt = timelineBucketStart(event.occurredAt);
    if (!startAt) continue;
    const bucket = grouped.get(startAt) ?? {
      startAt,
      events: 0,
      participantKeys: new Set<string>(),
      answers: 0,
      correct: 0,
      aiQuestions: 0,
      evaluations: 0
    };

    bucket.events += 1;
    if (event.anonymousKey) bucket.participantKeys.add(event.anonymousKey);
    if (event.eventType === "answer_selected") {
      bucket.answers += 1;
      if (event.payload.correct === true) bucket.correct += 1;
    }
    if (event.eventType === "ai_chat_requested") bucket.aiQuestions += 1;
    if (event.eventType === "evaluation_submitted") bucket.evaluations += 1;
    grouped.set(startAt, bucket);
  }

  const buckets = [...grouped.values()]
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .slice(-8)
    .map((bucket) => ({
      startAt: bucket.startAt,
      label: formatTimelineLabel(bucket.startAt),
      events: bucket.events,
      participants: bucket.participantKeys.size,
      answers: bucket.answers,
      correct: bucket.correct,
      correctRate: rate(bucket.correct, bucket.answers),
      aiQuestions: bucket.aiQuestions,
      evaluations: bucket.evaluations
    }));

  let recommendation = "Noch keine Aktivität im Zeitverlauf.";
  const latest = buckets.at(-1);
  if (latest) {
    if (buckets.length === 1) {
      recommendation = `Aktivität startet: ${latest.events} Events im ersten Abschnitt. Für echte Trends weitere Abschnitte sammeln.`;
    } else {
      recommendation = `Letzter Abschnitt: ${latest.answers} Antworten, ${latest.aiQuestions} KI-Fragen, ${latest.evaluations} Evaluationen.`;
    }
  }

  return {
    buckets,
    recommendation
  };
}

function buildQuestionQualitySummary(events: AnalyticsEventRecord[]): LectureAnalyticsSummary["questionQuality"] {
  const answerEvents = events.filter((event) => event.eventType === "answer_selected");
  const grouped = new Map<
    string,
    {
      questionText: string;
      level?: QuestionLevel;
      answers: number;
      correct: number;
      wrongSelections: Map<string, number>;
    }
  >();

  for (const event of answerEvents) {
    const level = levelPayload(event.payload.level);
    const questionText = textPayload(event.payload.questionText) || `Unbekannte Frage${level ? ` (Niveau ${level})` : ""}`;
    const key = `${level ?? "unknown"}:${questionText}`;
    const existing = grouped.get(key) ?? {
      questionText,
      level,
      answers: 0,
      correct: 0,
      wrongSelections: new Map<string, number>()
    };

    existing.answers += 1;
    if (event.payload.correct === true) {
      existing.correct += 1;
    } else {
      const selectedAnswerText = textPayload(event.payload.selectedAnswerText);
      const selectedAnswerKey = textPayload(event.payload.selectedAnswerKey) || textPayload(event.payload.selected);
      const wrongLabel = selectedAnswerText || (selectedAnswerKey ? `Antwort ${selectedAnswerKey}` : "Unbekannte Antwort");
      existing.wrongSelections.set(wrongLabel, (existing.wrongSelections.get(wrongLabel) ?? 0) + 1);
    }

    grouped.set(key, existing);
  }

  const items = [...grouped.values()]
    .map((item) => {
      const correctRate = rate(item.correct, item.answers);
      const mostSelectedWrong = [...item.wrongSelections.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
      let recommendation = "Unauffällig.";
      if (item.answers < 2) {
        recommendation = "Noch zu wenige Antworten für eine belastbare Aussage.";
      } else if (correctRate <= 40) {
        recommendation = "Frage oder Folienübergang prüfen; viele Studierende wählen falsche Antworten.";
      } else if (correctRate <= 65) {
        recommendation = "Erklärung und Ablenker prüfen; die Frage trennt, kann aber missverständlich sein.";
      } else if (correctRate >= 90 && item.answers >= 3) {
        recommendation = "Sehr leicht; optional als Wiederholung behalten oder ein höheres Niveau ergänzen.";
      }

      return {
        questionText: item.questionText,
        level: item.level,
        answers: item.answers,
        correct: item.correct,
        correctRate,
        wrong: item.answers - item.correct,
        mostSelectedWrong,
        recommendation
      };
    })
    .sort((left, right) => left.correctRate - right.correctRate || right.answers - left.answers || left.questionText.localeCompare(right.questionText))
    .slice(0, 5);

  let recommendation = "Noch keine Antwortdaten für Fragequalität.";
  const lowestRelevant = items.find((item) => item.answers >= 2);
  if (lowestRelevant) {
    if (lowestRelevant.correctRate <= 40) {
      recommendation = `Priorität: "${lowestRelevant.questionText}" prüfen; nur ${lowestRelevant.correctRate}% korrekt.`;
    } else if (lowestRelevant.correctRate <= 65) {
      recommendation = `Beobachten: "${lowestRelevant.questionText}" liegt bei ${lowestRelevant.correctRate}% korrekt.`;
    } else {
      recommendation = "Keine auffällige Fragequalität in den bisherigen Antwortdaten.";
    }
  }

  return {
    items,
    recommendation
  };
}

const topicDefinitions = [
  {
    topic: "Mischreibung und Verschleiß",
    keywords: ["mischreibung", "festkörperkontakt", "verschleiß", "reibung"],
    recommendation: "Folie und Frage zu Mischreibung schärfen: Kontaktzustand, Verschleißfolge und korrekte Gegenmaßnahme gemeinsam erklären."
  },
  {
    topic: "Schmierfilmaufbau",
    keywords: ["schmierfilm", "hydrodynam", "relativbewegung", "keil", "spalt", "druck"],
    recommendation: "Den Schmierfilmaufbau mit Skizze, Ursache-Wirkung-Kette und kurzer Begriffsfrage absichern."
  },
  {
    topic: "Stribeck und Betriebsparameter",
    keywords: ["stribeck", "sommerfeld", "viskosität", "drehzahl", "last", "lagerspiel", "betriebsparameter"],
    recommendation: "Stribeck-Zusammenhang stärker an Parametern zeigen: Viskosität, Drehzahl, Last und Lagerspiel gegenüberstellen."
  },
  {
    topic: "Anlauf und Transfer",
    keywords: ["anlauf", "start", "startphase", "langsam", "entlast", "welle", "transfer"],
    recommendation: "Transferaufgabe zur Startphase ergänzen und konstruktive Maßnahmen explizit mit dem Lagerproblem verknüpfen."
  },
  {
    topic: "KI-Hilfe und Quellen",
    keywords: ["ki", "assistent", "quelle", "chat", "erklärung", "hilfe"],
    recommendation: "KI-Hilfe mit klareren Quellenhinweisen, Folgefragen und kurzer Zusammenfassung nach der Frage ausbauen."
  },
  {
    topic: "Tempo und Verständlichkeit",
    keywords: ["tempo", "schnell", "langsam", "verständlich", "unklar", "verstehen", "erklärung"],
    recommendation: "Tempo und Erklärpausen prüfen; kritische Begriffe vor Transferfragen kurz wiederholen."
  }
] as const;

function clusterEventText(event: AnalyticsEventRecord) {
  const values: string[] = [];
  const payload = event.payload;

  for (const key of [
    "questionText",
    "selectedAnswerText",
    "correctAnswerText",
    "message",
    "comment",
    "evaluationTitle"
  ]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
  }

  const labels = payload.labels;
  if (labels && typeof labels === "object") {
    for (const value of Object.values(labels)) {
      if (typeof value === "string" && value.trim()) values.push(value.trim());
    }
  }

  return values.join(" ").toLowerCase();
}

function shortEvidence(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function buildTopicClusterSummary(events: AnalyticsEventRecord[], chatQuestions: ChatQuestionClusterSignal[] = []): LectureAnalyticsSummary["topicClusters"] {
  const clusterMap = new Map<
    string,
    {
      topic: string;
      signalCount: number;
      answerCount: number;
      correctAnswers: number;
      wrongAnswers: number;
      aiQuestions: number;
      chatQuestions: number;
      acceptedChatQuestions: number;
      evaluationMentions: number;
      riskScore: number;
      evidence: string[];
      recommendation: string;
    }
  >();

  for (const definition of topicDefinitions) {
    clusterMap.set(definition.topic, {
      topic: definition.topic,
      signalCount: 0,
      answerCount: 0,
      correctAnswers: 0,
      wrongAnswers: 0,
      aiQuestions: 0,
      chatQuestions: 0,
      acceptedChatQuestions: 0,
      evaluationMentions: 0,
      riskScore: 0,
      evidence: [],
      recommendation: definition.recommendation
    });
  }

  for (const event of events) {
    const text = clusterEventText(event);
    if (!text) continue;
    const matchedTopics = topicDefinitions.filter((definition) =>
      definition.keywords.some((keyword) => text.includes(keyword))
    );

    for (const definition of matchedTopics) {
      const cluster = clusterMap.get(definition.topic);
      if (!cluster) continue;

      cluster.signalCount += 1;
      if (event.eventType === "answer_selected") {
        cluster.answerCount += 1;
        if (event.payload.correct === true) {
          cluster.correctAnswers += 1;
          cluster.riskScore += 1;
        } else {
          cluster.wrongAnswers += 1;
          cluster.riskScore += 4;
        }
      } else if (event.eventType === "ai_chat_requested") {
        cluster.aiQuestions += 1;
        cluster.riskScore += 2;
      } else if (event.eventType === "evaluation_submitted") {
        cluster.evaluationMentions += 1;
        cluster.riskScore += 2;
      } else {
        cluster.riskScore += 1;
      }

      const evidence =
        textPayload(event.payload.questionText) ||
        textPayload(event.payload.message) ||
        textPayload(event.payload.comment) ||
        textPayload(event.payload.evaluationTitle);
      const clipped = shortEvidence(evidence);
      if (clipped && !cluster.evidence.includes(clipped) && cluster.evidence.length < 3) {
        cluster.evidence.push(clipped);
      }
    }
  }

  for (const question of chatQuestions) {
    const text = `${question.text} ${question.sourceTopic ?? ""} ${question.relevanceReason}`.toLowerCase();
    if (!text.trim()) continue;
    const matchedTopics = topicDefinitions.filter((definition) =>
      definition.keywords.some((keyword) => text.includes(keyword))
    );

    for (const definition of matchedTopics) {
      const cluster = clusterMap.get(definition.topic);
      if (!cluster) continue;

      cluster.signalCount += 1;
      cluster.chatQuestions += 1;
      if (question.status === "accepted") {
        cluster.acceptedChatQuestions += 1;
        cluster.riskScore += 3;
      } else {
        cluster.riskScore += 1;
      }

      const clipped = shortEvidence(`Chatfrage: ${question.text}`);
      if (clipped && !cluster.evidence.includes(clipped) && cluster.evidence.length < 3) {
        cluster.evidence.push(clipped);
      }
    }
  }

  const items = [...clusterMap.values()]
    .filter((cluster) => cluster.signalCount > 0)
    .map((cluster) => {
      let riskLevel: "hoch" | "mittel" | "beobachten" = "beobachten";
      if (cluster.wrongAnswers >= 2 || cluster.acceptedChatQuestions >= 2 || cluster.riskScore >= 8) {
        riskLevel = "hoch";
      } else if (cluster.wrongAnswers >= 1 || cluster.chatQuestions >= 1 || cluster.aiQuestions >= 2 || cluster.evaluationMentions >= 1 || cluster.riskScore >= 4) {
        riskLevel = "mittel";
      }

      return {
        topic: cluster.topic,
        signalCount: cluster.signalCount,
        answerCount: cluster.answerCount,
        wrongAnswers: cluster.wrongAnswers,
        correctRate: rate(cluster.correctAnswers, cluster.answerCount),
        aiQuestions: cluster.aiQuestions,
        chatQuestions: cluster.chatQuestions,
        acceptedChatQuestions: cluster.acceptedChatQuestions,
        evaluationMentions: cluster.evaluationMentions,
        riskLevel,
        evidence: cluster.evidence,
        recommendation: cluster.recommendation
      };
    })
    .sort((left, right) => {
      const riskOrder = { hoch: 0, mittel: 1, beobachten: 2 };
      return riskOrder[left.riskLevel] - riskOrder[right.riskLevel] || right.signalCount - left.signalCount || left.topic.localeCompare(right.topic);
    })
    .slice(0, 5);

  let recommendation = "Noch keine Themencluster aus den bisherigen Events.";
  const priority = items[0];
  if (priority) {
    recommendation = priority.riskLevel === "hoch"
      ? `Priorität: ${priority.topic} vor der nächsten Durchführung überarbeiten.`
      : `Beobachten: ${priority.topic} sammelt die stärksten Signale.`;
  }

  return {
    items,
    recommendation
  };
}

function buildEvaluationSummary(events: AnalyticsEventRecord[]) {
  const evaluationEvents = events.filter((event) => event.eventType === "evaluation_submitted");
  const understanding = evaluationEvents.map((event) => numericRating(event.payload.understanding)).filter(Boolean);
  const pace = evaluationEvents.map((event) => numericRating(event.payload.pace)).filter(Boolean);
  const aiHelpful = evaluationEvents.map((event) => numericRating(event.payload.aiHelpful)).filter(Boolean);
  const comments = evaluationEvents
    .map((event) => (typeof event.payload.comment === "string" ? event.payload.comment.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
  const understandingAverage = average(understanding);
  const paceAverage = average(pace);
  const aiHelpfulAverage = average(aiHelpful);
  const versionGroups = new Map<number, AnalyticsEventRecord[]>();
  for (const event of evaluationEvents) {
    const version = Number(event.payload.evaluationVersion);
    const normalizedVersion = Number.isInteger(version) && version > 0 ? version : 1;
    versionGroups.set(normalizedVersion, [...(versionGroups.get(normalizedVersion) ?? []), event]);
  }
  const versions = [...versionGroups.entries()]
    .map(([version, versionEvents]) => {
      const understandingValues = versionEvents.map((event) => numericRating(event.payload.understanding)).filter(Boolean);
      const paceValues = versionEvents.map((event) => numericRating(event.payload.pace)).filter(Boolean);
      const aiHelpfulValues = versionEvents.map((event) => numericRating(event.payload.aiHelpful)).filter(Boolean);
      const title = [...versionEvents]
        .reverse()
        .map((event) => (typeof event.payload.evaluationTitle === "string" ? event.payload.evaluationTitle.trim() : ""))
        .find(Boolean) ?? `Evaluation V${version}`;
      const lastSubmittedAt = versionEvents
        .map((event) => event.occurredAt)
        .sort()
        .at(-1);

      return {
        version,
        title,
        count: versionEvents.length,
        understandingAverage: average(understandingValues),
        paceAverage: average(paceValues),
        aiHelpfulAverage: average(aiHelpfulValues),
        lastSubmittedAt
      };
    })
    .sort((left, right) => right.version - left.version);

  let recommendation = "Noch keine Evaluationen für eine belastbare Empfehlung.";
  if (evaluationEvents.length > 0) {
    if (understandingAverage > 0 && understandingAverage < 3.5) {
      recommendation = "Mehr Transferbeispiele und kurze Wiederholungsfragen für die nächste Durchführung einplanen.";
    } else if (paceAverage > 0 && paceAverage < 3.5) {
      recommendation = "Tempo und Erklärpausen prüfen; Studierende melden hier den stärksten Bedarf.";
    } else if (aiHelpfulAverage >= 4) {
      recommendation = "KI-Assistent wird hilfreich bewertet; Quellenhinweise und Folgefragen weiter ausbauen.";
    } else {
      recommendation = "Evaluation stabil; nächste Iteration über Fragequalität und Freitextkommentare priorisieren.";
    }
  }

  return {
    count: evaluationEvents.length,
    understandingAverage,
    paceAverage,
    aiHelpfulAverage,
    comments,
    versions,
    recommendation
  };
}

function buildAiUsageSummary(events: AnalyticsEventRecord[]) {
  const openedEvents = events.filter((event) => event.eventType === "ai_chat_opened");
  const requestEvents = events.filter((event) => event.eventType === "ai_chat_requested");
  const answeredEvents = events.filter((event) => event.eventType === "ai_chat_answered");
  const blockedEvents = events.filter((event) => event.eventType === "ai_chat_blocked");
  const tokens = answeredEvents.reduce((sum, event) => {
    const tokenPayload = event.payload.tokens;
    if (!tokenPayload || typeof tokenPayload !== "object") return sum;
    const total = "total" in tokenPayload ? Number(tokenPayload.total) : 0;
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);
  const inputTokens = answeredEvents.reduce((sum, event) => {
    const tokenPayload = event.payload.tokens;
    if (!tokenPayload || typeof tokenPayload !== "object") return sum;
    const total = "input" in tokenPayload ? Number(tokenPayload.input) : 0;
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);
  const outputTokens = answeredEvents.reduce((sum, event) => {
    const tokenPayload = event.payload.tokens;
    if (!tokenPayload || typeof tokenPayload !== "object") return sum;
    const total = "output" in tokenPayload ? Number(tokenPayload.output) : 0;
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);
  const sourceCitations = answeredEvents.reduce((sum, event) => {
    const sources = event.payload.sources;
    return sum + (Array.isArray(sources) ? sources.length : 0);
  }, 0);
  const lastPrompt = [...requestEvents]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .map((event) => (typeof event.payload.message === "string" ? event.payload.message.trim() : ""))
    .filter(Boolean)
    .at(-1);
  const eventCostEstimates = answeredEvents.flatMap((event) => {
    const value = event.payload.costEstimate;
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const estimatedEur = Number(record.estimatedEur);
    if (!Number.isFinite(estimatedEur)) return [];
    return [{
      provider: typeof record.provider === "string" ? record.provider : undefined,
      model: typeof record.model === "string" ? record.model : undefined,
      estimatedEur,
      inputEurPer1k: Number(record.inputEurPer1k),
      outputEurPer1k: Number(record.outputEurPer1k)
    }];
  });
  const lastCostEstimate = eventCostEstimates.at(-1);
  const baseCost = estimateAiCost({
    inputTokens,
    outputTokens,
    provider: lastCostEstimate?.provider,
    model: lastCostEstimate?.model
  });
  const estimatedEur = eventCostEstimates.length > 0
    ? Math.round(eventCostEstimates.reduce((sum, cost) => sum + cost.estimatedEur, 0) * 1_000_000) / 1_000_000
    : baseCost.estimatedEur;
  const warningLevel: "ok" | "watch" | "critical" = estimatedEur >= baseCost.criticalEur
    ? "critical"
    : estimatedEur >= baseCost.warningEur
      ? "watch"
      : "ok";
  let warning = "Kosten im konfigurierten Rahmen.";
  if (warningLevel === "watch") {
    warning = `Kostenwarnung: ${estimatedEur.toFixed(4)} EUR seit Start dieser Vorlesung. Budget prüfen.`;
  } else if (warningLevel === "critical") {
    warning = `Kritische Kostenwarnung: ${estimatedEur.toFixed(4)} EUR seit Start dieser Vorlesung. Limit und Freigabe prüfen.`;
  } else if (inputTokens + outputTokens === 0) {
    warning = "Noch keine beantworteten KI-Anfragen.";
  }

  return {
    opened: openedEvents.length,
    messages: requestEvents.length,
    blocked: blockedEvents.length,
    tokens,
    sourceCitations,
    lastPrompt,
    cost: {
      ...baseCost,
      provider: lastCostEstimate?.provider ?? baseCost.provider,
      model: lastCostEstimate?.model ?? baseCost.model,
      inputEurPer1k: Number.isFinite(lastCostEstimate?.inputEurPer1k) ? lastCostEstimate!.inputEurPer1k : baseCost.inputEurPer1k,
      outputEurPer1k: Number.isFinite(lastCostEstimate?.outputEurPer1k) ? lastCostEstimate!.outputEurPer1k : baseCost.outputEurPer1k,
      estimatedEur,
      warningLevel,
      warning
    }
  };
}

function buildSeriesTrendSummary(input: {
  seriesTitle?: string;
  currentLectureId: string;
  lectures: Array<{ lectureId: string; lectureToken: string; lectureTitle: string; liveAt: string }>;
  events: AnalyticsEventRecord[];
  participantCounts?: Map<string, number>;
}): LectureAnalyticsSummary["seriesTrend"] {
  const items = input.lectures
    .map((lecture) => {
      const lectureEvents = input.events.filter((event) => event.lectureToken === lecture.lectureToken);
      const answerEvents = lectureEvents.filter((event) => event.eventType === "answer_selected");
      const participants = input.participantCounts?.get(lecture.lectureId)
        ?? new Set(lectureEvents.map((event) => event.anonymousKey).filter(Boolean)).size;
      const correct = answerEvents.filter((event) => event.payload.correct === true).length;
      const topTopic = buildTopicClusterSummary(lectureEvents).items[0];

      return {
        lectureId: lecture.lectureId,
        lectureToken: lecture.lectureToken,
        lectureTitle: lecture.lectureTitle,
        liveAt: lecture.liveAt,
        participants,
        answers: answerEvents.length,
        correctRate: rate(correct, answerEvents.length),
        aiQuestions: lectureEvents.filter((event) => event.eventType === "ai_chat_requested").length,
        evaluations: lectureEvents.filter((event) => event.eventType === "evaluation_submitted").length,
        topTopic: topTopic?.topic,
        riskLevel: topTopic?.riskLevel
      } satisfies AnalyticsSeriesTrendItem;
    })
    .sort((left, right) => left.liveAt.localeCompare(right.liveAt));

  const currentIndex = items.findIndex((item) => item.lectureId === input.currentLectureId);
  const current = currentIndex >= 0 ? items[currentIndex] : undefined;
  const previousWithAnswers = current
    ? [...items.slice(0, currentIndex)].reverse().find((item) => item.answers > 0)
    : undefined;

  let recommendation = "Noch keine zweite Vorlesung derselben Reihe mit Vergleichsdaten.";
  if (current && previousWithAnswers && current.answers > 0) {
    const delta = current.correctRate - previousWithAnswers.correctRate;
    if (delta >= 10) {
      recommendation = `Verbesserung gegenüber "${previousWithAnswers.lectureTitle}": Korrektquote +${delta} Prozentpunkte. Muster sichern.`;
    } else if (delta <= -10) {
      recommendation = `Rückgang gegenüber "${previousWithAnswers.lectureTitle}": Korrektquote ${delta} Prozentpunkte. Folienübergang und Fragen prüfen.`;
    } else {
      recommendation = `Stabil gegenüber "${previousWithAnswers.lectureTitle}": Korrektquote verändert sich um ${delta} Prozentpunkte.`;
    }
  } else if (items.filter((item) => item.answers > 0 || item.evaluations > 0 || item.aiQuestions > 0).length >= 2) {
    recommendation = "Reihenverlauf hat mehrere Vorlesungen mit Aktivität; für Trendbewertung aktuelle Vorlesung beantworten lassen.";
  }

  return {
    seriesTitle: input.seriesTitle ?? "Vorlesungsreihe",
    items,
    recommendation
  };
}

const suggestionPriorityRank = {
  hoch: 0,
  mittel: 1,
  beobachten: 2
} satisfies Record<AnalyticsImprovementSuggestionItem["priority"], number>;

function addImprovementSuggestion(
  suggestions: AnalyticsImprovementSuggestionItem[],
  suggestion: Omit<AnalyticsImprovementSuggestionItem, "id">
) {
  const normalizedTitle = suggestion.title.toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "vorschlag";
  const id = `${suggestion.source}-${normalizedTitle}`;
  if (suggestions.some((item) => item.id === id || item.title === suggestion.title)) return;
  suggestions.push({ id, ...suggestion });
}

function buildImprovementSuggestions(input: {
  currentLectureId: string;
  aiUsage: LectureAnalyticsSummary["aiUsage"];
  questionQuality: LectureAnalyticsSummary["questionQuality"];
  topicClusters: LectureAnalyticsSummary["topicClusters"];
  seriesTrend: LectureAnalyticsSummary["seriesTrend"];
  evaluation: LectureAnalyticsSummary["evaluation"];
}): LectureAnalyticsSummary["improvementSuggestions"] {
  const suggestions: AnalyticsImprovementSuggestionItem[] = [];
  const priorityCluster = input.topicClusters.items.find((cluster) => cluster.riskLevel !== "beobachten" || cluster.signalCount >= 3);
  if (priorityCluster) {
    addImprovementSuggestion(suggestions, {
      priority: priorityCluster.riskLevel === "hoch" ? "hoch" : "mittel",
      area: "Folie",
      source: "topic_cluster",
      title: `Folie zu ${priorityCluster.topic} schärfen`,
      evidence: [
        `${priorityCluster.signalCount} Signale, ${priorityCluster.wrongAnswers} falsche Antworten, ${priorityCluster.aiQuestions} KI-Fragen`,
        ...priorityCluster.evidence.slice(0, 2)
      ],
      action: `${priorityCluster.recommendation} Danach eine kurze 4.0-Begriffsfrage und eine 2.0-Erklärfrage im Review prüfen.`
    });
  }

  const weakQuestion = input.questionQuality.items.find((item) => item.answers >= 2 && item.correctRate <= 65);
  if (weakQuestion) {
    addImprovementSuggestion(suggestions, {
      priority: weakQuestion.correctRate <= 40 ? "hoch" : "mittel",
      area: "Frage",
      source: "question_quality",
      title: `Frage überarbeiten: ${shortEvidence(weakQuestion.questionText)}`,
      evidence: [
        `${weakQuestion.answers} Antworten, ${weakQuestion.correctRate}% korrekt`,
        weakQuestion.mostSelectedWrong ? `Häufig falsch gewählt: ${weakQuestion.mostSelectedWrong}` : `${weakQuestion.wrong} falsche Antworten`
      ],
      action: "Fragekarte im Review öffnen, Erklärung präzisieren und die häufige falsche Antwort im Feedback gezielt gegenüberstellen."
    });
  }

  const currentIndex = input.seriesTrend.items.findIndex((item) => item.lectureId === input.currentLectureId);
  const currentTrend = currentIndex >= 0 ? input.seriesTrend.items[currentIndex] : undefined;
  const previousTrend = currentTrend
    ? [...input.seriesTrend.items.slice(0, currentIndex)].reverse().find((item) => item.answers > 0)
    : undefined;
  if (currentTrend && previousTrend && currentTrend.answers > 0) {
    const delta = currentTrend.correctRate - previousTrend.correctRate;
    if (delta <= -10) {
      addImprovementSuggestion(suggestions, {
        priority: "hoch",
        area: "Tempo",
        source: "series_trend",
        title: `Rückgang gegenüber ${previousTrend.lectureTitle} prüfen`,
        evidence: [
          `${previousTrend.lectureTitle}: ${previousTrend.correctRate}% korrekt`,
          `${currentTrend.lectureTitle}: ${currentTrend.correctRate}% korrekt`
        ],
        action: "Folienübergang, Erklärtempo und Fragezeitpunkt der aktuellen Einheit vor der nächsten Durchführung vergleichen."
      });
    } else if (delta >= 10) {
      addImprovementSuggestion(suggestions, {
        priority: "beobachten",
        area: "Folie",
        source: "series_trend",
        title: `Verbesserung gegenüber ${previousTrend.lectureTitle} sichern`,
        evidence: [
          `${previousTrend.lectureTitle}: ${previousTrend.correctRate}% korrekt`,
          `${currentTrend.lectureTitle}: ${currentTrend.correctRate}% korrekt`
        ],
        action: "Das Muster der erfolgreichen Erklärung dokumentieren und für spätere Vorlesungen der Reihe als Vorlage behalten."
      });
    }
  }

  if (input.evaluation.count > 0 && input.evaluation.understandingAverage > 0 && input.evaluation.understandingAverage < 3.5) {
    addImprovementSuggestion(suggestions, {
      priority: input.evaluation.understandingAverage < 3 ? "hoch" : "mittel",
      area: "Evaluation",
      source: "evaluation",
      title: "Verständnis aus Evaluation nacharbeiten",
      evidence: [
        `${input.evaluation.count} Rückmeldungen`,
        `Verständnis ${input.evaluation.understandingAverage}/5`
      ],
      action: "Im Learn-Modus eine kompakte Nachbereitungsfrage und in der nächsten Live-Sitzung ein Transferbeispiel einplanen."
    });
  }

  if (input.evaluation.count > 0 && input.evaluation.paceAverage > 0 && input.evaluation.paceAverage < 3.5) {
    addImprovementSuggestion(suggestions, {
      priority: input.evaluation.paceAverage < 3 ? "hoch" : "mittel",
      area: "Tempo",
      source: "evaluation",
      title: "Tempo und Erklärpausen prüfen",
      evidence: [
        `${input.evaluation.count} Rückmeldungen`,
        `Tempo ${input.evaluation.paceAverage}/5`
      ],
      action: "Bei den nächsten kritischen Begriffen eine explizite Pause mit kurzer Begriffsfrage setzen."
    });
  }

  if (input.aiUsage.blocked > 0) {
    addImprovementSuggestion(suggestions, {
      priority: "mittel",
      area: "KI",
      source: "ai_usage",
      title: "KI-Budget oder Freischaltung prüfen",
      evidence: [
        `${input.aiUsage.blocked} blockierte KI-Anfragen`,
        `${input.aiUsage.messages} KI-Fragen insgesamt`
      ],
      action: "Prüfungsdatum, Tageslimit und Tokenbudget vor der Übungsphase prüfen, damit sinnvolle Lernfragen nicht unbeabsichtigt blockiert werden."
    });
  }

  const items = suggestions
    .sort((left, right) => suggestionPriorityRank[left.priority] - suggestionPriorityRank[right.priority] || left.area.localeCompare(right.area))
    .slice(0, 5);

  const highPriority = items.filter((item) => item.priority === "hoch").length;
  const recommendation = items.length === 0
    ? "Noch keine belastbaren Verbesserungsvorschläge. Erst weitere Antworten, KI-Fragen oder Evaluationen sammeln."
    : highPriority > 0
      ? `${highPriority} priorisierte Vorschläge: zuerst "${items[0].title}" bearbeiten.`
      : `Nächste Iteration: "${items[0].title}" als erstes sichern.`;

  return {
    items,
    recommendation
  };
}

function buildImprovementHistorySummary(events: AnalyticsEventRecord[]): LectureAnalyticsSummary["improvementHistory"] {
  function coerceDiff(value: unknown, fallback: { before: string; after: string }): AnalyticsImprovementDiffField[] {
    if (!Array.isArray(value)) {
      return [{
        field: "change",
        label: "Änderung",
        before: fallback.before,
        after: fallback.after
      }];
    }

    const fields = value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      const before = shortEvidence(textPayload(candidate.before));
      const after = shortEvidence(textPayload(candidate.after));
      if (!before || !after) return [];
      return [{
        field: shortEvidence(textPayload(candidate.field)) || "change",
        label: shortEvidence(textPayload(candidate.label)) || "Änderung",
        before,
        after
      }];
    }).slice(0, 8);

    return fields.length > 0 ? fields : [{
      field: "change",
      label: "Änderung",
      before: fallback.before,
      after: fallback.after
    }];
  }

  const items = events
    .filter((event) => event.eventType === "improvement_draft_applied")
    .map((event) => {
      const kindPayload = event.payload.kind;
      const kind: "slide" | "question" = kindPayload === "question" ? "question" : "slide";
      const before = shortEvidence(textPayload(event.payload.before));
      const after = shortEvidence(textPayload(event.payload.after));
      return {
        id: event.id,
        occurredAt: event.occurredAt,
        kind,
        targetLabel: textPayload(event.payload.targetLabel) || (kind === "slide" ? "Folie" : "Frage"),
        title: textPayload(event.payload.title) || "Änderungsentwurf übernommen",
        before,
        after,
        diff: coerceDiff(event.payload.diff, { before, after }),
        suggestionId: textPayload(event.payload.suggestionId) || undefined
      };
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 8);

  const recommendation = items.length === 0
    ? "Noch keine übernommenen Änderungsentwürfe."
    : `${items.length} übernommene ${items.length === 1 ? "Änderung" : "Änderungen"} im Qualitätsregelkreis dokumentiert.`;

  return {
    items,
    recommendation
  };
}

function normalizedComparableText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function answerQuestionText(event: AnalyticsEventRecord) {
  return textPayload(event.payload.questionText) || textPayload(event.payload.question);
}

function answerMetrics(events: AnalyticsEventRecord[]) {
  const correct = events.filter((event) => event.payload.correct === true).length;
  return {
    answers: events.length,
    correctRate: rate(correct, events.length)
  };
}

function buildImprovementImpactSummary(events: AnalyticsEventRecord[]): LectureAnalyticsSummary["improvementImpact"] {
  const answerEvents = events.filter((event) => event.eventType === "answer_selected");
  const items = events
    .filter((event) => event.eventType === "improvement_draft_applied")
    .map((event) => {
      const kindPayload = event.payload.kind;
      const kind: "slide" | "question" = kindPayload === "question" ? "question" : "slide";
      const appliedAt = event.occurredAt;
      const beforeText = normalizedComparableText(textPayload(event.payload.before));
      const afterText = normalizedComparableText(textPayload(event.payload.after));
      const beforeEvents = answerEvents.filter((answerEvent) => {
        if (answerEvent.occurredAt > appliedAt) return false;
        if (kind !== "question" || !beforeText) return true;
        return normalizedComparableText(answerQuestionText(answerEvent)) === beforeText;
      });
      const afterEvents = answerEvents.filter((answerEvent) => {
        if (answerEvent.occurredAt <= appliedAt) return false;
        if (kind !== "question" || !afterText) return true;
        return normalizedComparableText(answerQuestionText(answerEvent)) === afterText;
      });
      const before = answerMetrics(beforeEvents);
      const after = answerMetrics(afterEvents);
      const delta = after.correctRate - before.correctRate;
      const hasEnoughData = before.answers >= 2 && after.answers >= 2;
      const status: LectureAnalyticsSummary["improvementImpact"]["items"][number]["status"] = !hasEnoughData
        ? "zu_wenig_daten"
        : delta >= 10
          ? "verbessert"
          : delta <= -10
            ? "kritisch"
            : "stabil";
      const recommendation = !hasEnoughData
        ? "Noch zu wenige Antworten vor und nach der Änderung für eine belastbare Wirkungsmessung."
        : status === "verbessert"
          ? `Wirkung sichtbar: Korrektquote um ${delta} Prozentpunkte gestiegen. Änderung als Muster sichern.`
          : status === "kritisch"
            ? `Wirkung kritisch: Korrektquote um ${Math.abs(delta)} Prozentpunkte gesunken. Änderung erneut prüfen.`
            : `Wirkung stabil: Korrektquote verändert sich um ${delta} Prozentpunkte. Weiter beobachten.`;

      return {
        id: event.id,
        appliedAt,
        kind,
        targetLabel: textPayload(event.payload.targetLabel) || (kind === "slide" ? "Folie" : "Frage"),
        title: textPayload(event.payload.title) || "Übernommene Änderung",
        beforeAnswers: before.answers,
        beforeCorrectRate: before.correctRate,
        afterAnswers: after.answers,
        afterCorrectRate: after.correctRate,
        delta,
        status,
        recommendation
      };
    })
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt))
    .slice(0, 6);

  const evaluated = items.filter((item) => item.status !== "zu_wenig_daten");
  const improved = evaluated.filter((item) => item.status === "verbessert").length;
  const critical = evaluated.filter((item) => item.status === "kritisch").length;
  const recommendation = items.length === 0
    ? "Noch keine übernommenen Änderungen für eine Wirkungsmessung."
    : evaluated.length === 0
      ? "Übernommene Änderungen sind dokumentiert; für Wirkungsmessung fehlen noch Antworten nach der Änderung."
      : critical > 0
        ? `${critical} Änderung${critical === 1 ? "" : "en"} mit kritischer Wirkung erneut prüfen.`
        : improved > 0
          ? `${improved} Änderung${improved === 1 ? "" : "en"} zeigen bessere Korrektquoten.`
          : "Wirkung der Änderungen ist bisher stabil. Weitere Durchführungen beobachten.";

  return {
    items,
    recommendation
  };
}

function buildSummary(input: {
  lectureId: string;
  lectureToken: string;
  seriesTitle?: string;
  events: AnalyticsEventRecord[];
  chatQuestions?: ChatQuestionClusterSignal[];
  participantCount?: number;
  seriesTrend?: LectureAnalyticsSummary["seriesTrend"];
}): LectureAnalyticsSummary {
  const lectureEvents = input.events.filter((event) => event.lectureToken === input.lectureToken);
  const answerEvents = lectureEvents.filter((event) => event.eventType === "answer_selected");
  const participantKeys = new Set(lectureEvents.map((event) => event.anonymousKey).filter((key): key is string => Boolean(key)));
  const participants = input.participantCount ?? participantKeys.size;
  const correct = answerEvents.filter((event) => event.payload.correct === true).length;
  const lastEventAt = lectureEvents
    .map((event) => event.occurredAt)
    .sort()
    .at(-1);
  const aiUsage = buildAiUsageSummary(lectureEvents);
  const questionQuality = buildQuestionQualitySummary(lectureEvents);
  const activityTimeline = buildActivityTimelineSummary(lectureEvents);
  const topicClusters = buildTopicClusterSummary(lectureEvents, input.chatQuestions ?? []);
  const seriesTrend = input.seriesTrend ?? buildSeriesTrendSummary({
    seriesTitle: input.seriesTitle,
    currentLectureId: input.lectureId,
    lectures: [{ lectureId: input.lectureId, lectureToken: input.lectureToken, lectureTitle: "Aktuelle Vorlesung", liveAt: lastEventAt ?? new Date(0).toISOString() }],
    events: lectureEvents,
    participantCounts: new Map([[input.lectureId, participants]])
  });
  const evaluation = buildEvaluationSummary(lectureEvents);
  const improvementHistory = buildImprovementHistorySummary(lectureEvents);
  const improvementImpact = buildImprovementImpactSummary(lectureEvents);

  return {
    lectureId: input.lectureId,
    lectureToken: input.lectureToken,
    participants,
    answers: answerEvents.length,
    correct,
    answerRate: rate(answerEvents.length, participants),
    correctRate: rate(correct, answerEvents.length),
    levels: levels.map((level) => {
      const levelAnswers = answerEvents.filter((event) => event.payload.level === level);
      const levelCorrect = levelAnswers.filter((event) => event.payload.correct === true).length;
      return {
        level,
        answers: levelAnswers.length,
        correct: levelCorrect,
        correctRate: rate(levelCorrect, levelAnswers.length)
      };
    }),
    aiUsage,
    questionQuality,
    activityTimeline,
    topicClusters,
    seriesTrend,
    improvementSuggestions: buildImprovementSuggestions({
      currentLectureId: input.lectureId,
      aiUsage,
      questionQuality,
      topicClusters,
      seriesTrend,
      evaluation
    }),
    improvementHistory,
    improvementImpact,
    evaluation,
    lastEventAt
  };
}

class LocalAnalyticsRepository implements AnalyticsRepository {
  async recordEvent(input: AnalyticsEventInput) {
    const store = await readLocalAnalyticsStore();
    const event: AnalyticsEventRecord = {
      id: `event_${crypto.randomUUID()}`,
      lectureToken: input.lectureToken,
      eventType: input.eventType,
      payload: input.payload,
      anonymousKey: input.anonymousKey,
      pseudonym: input.pseudonym,
      occurredAt: new Date().toISOString()
    };

    store.events.push(event);
    await writeLocalAnalyticsStore(store);
    return { event, count: store.events.length };
  }

  async listEvents() {
    const store = await readLocalAnalyticsStore();
    return store.events;
  }

  async getLectureSummary(input: { lectureId: string; lectureToken: string; seriesTitle?: string }) {
    const events = await this.listEvents();
    return buildSummary({ ...input, events });
  }

  async getLectureLeaderboard(input: { lectureId: string; lectureToken: string; currentAnonymousKey?: string }) {
    const events = (await this.listEvents()).filter((event) => event.lectureToken === input.lectureToken);
    return buildLeaderboardEntries(events, input.currentAnonymousKey);
  }
}

class PostgresAnalyticsRepository implements AnalyticsRepository {
  private readonly db = getDb();

  async recordEvent(input: AnalyticsEventInput) {
    const lecture = input.lectureToken
      ? await this.db.select({ id: lectures.id, publicToken: lectures.publicToken }).from(lectures).where(eq(lectures.publicToken, input.lectureToken)).limit(1)
      : [];
    const lectureId = lecture[0]?.id ?? null;

    if (input.lectureToken && !lectureId) return null;

    const participantSessionId =
      lectureId && input.anonymousKey
        ? await this.findOrCreateParticipantSession({
            lectureId,
            anonymousKey: input.anonymousKey,
            pseudonym: input.pseudonym ?? "Pseudonym"
          })
        : null;

    const [created] = await this.db
      .insert(analyticsEvents)
      .values({
        lectureId,
        participantSessionId,
        eventType: input.eventType,
        eventPayload: input.payload
      })
      .returning();

    const count = await this.db.$count(analyticsEvents);

    return {
      event: {
        id: created.id,
        lectureToken: lecture[0]?.publicToken,
        eventType: created.eventType,
        payload: created.eventPayload as Record<string, unknown>,
        anonymousKey: input.anonymousKey,
        pseudonym: input.pseudonym,
        occurredAt: created.occurredAt.toISOString()
      },
      count
    };
  }

  async listEvents() {
    const rows = await this.db
      .select({
        event: analyticsEvents,
        lecture: lectures,
        participant: participantSessions
      })
      .from(analyticsEvents)
      .leftJoin(lectures, eq(analyticsEvents.lectureId, lectures.id))
      .leftJoin(participantSessions, eq(analyticsEvents.participantSessionId, participantSessions.id))
      .orderBy(desc(analyticsEvents.occurredAt));

    return rows.map((row) => ({
      id: row.event.id,
      lectureToken: row.lecture?.publicToken,
      eventType: row.event.eventType,
      payload: row.event.eventPayload as Record<string, unknown>,
      anonymousKey: row.participant?.anonymousKey,
      pseudonym: row.participant?.pseudonym,
      occurredAt: row.event.occurredAt.toISOString()
    }));
  }

  async getLectureSummary(input: { lectureId: string; lectureToken: string }) {
    const [currentLecture] = await this.db
      .select({
        id: lectures.id,
        publicToken: lectures.publicToken,
        title: lectures.title,
        liveAt: lectures.liveAt,
        seriesId: lectures.seriesId,
        seriesTitle: lectureSeries.title
      })
      .from(lectures)
      .leftJoin(lectureSeries, eq(lectures.seriesId, lectureSeries.id))
      .where(eq(lectures.id, input.lectureId))
      .limit(1);

    const seriesLectureRows = currentLecture?.seriesId
      ? await this.db
          .select({ id: lectures.id, publicToken: lectures.publicToken, title: lectures.title, liveAt: lectures.liveAt })
          .from(lectures)
          .where(eq(lectures.seriesId, currentLecture.seriesId))
      : currentLecture
        ? [{ id: currentLecture.id, publicToken: currentLecture.publicToken, title: currentLecture.title, liveAt: currentLecture.liveAt }]
        : [];
    const lectureIds = seriesLectureRows.map((lecture) => lecture.id);

    const [eventRows, participantRows, chatQuestionRows, seriesParticipantRows] = await Promise.all([
      this.db
        .select({
          event: analyticsEvents,
          lecture: lectures,
          participant: participantSessions
        })
        .from(analyticsEvents)
        .leftJoin(lectures, eq(analyticsEvents.lectureId, lectures.id))
        .leftJoin(participantSessions, eq(analyticsEvents.participantSessionId, participantSessions.id))
        .where(eq(analyticsEvents.lectureId, input.lectureId))
        .orderBy(desc(analyticsEvents.occurredAt)),
      this.db.select({ id: participantSessions.id }).from(participantSessions).where(eq(participantSessions.lectureId, input.lectureId)),
      this.db
        .select()
        .from(studentChatQuestions)
        .where(eq(studentChatQuestions.lectureId, input.lectureId))
        .orderBy(desc(studentChatQuestions.createdAt)),
      lectureIds.length > 0
        ? this.db.select({ id: participantSessions.id, lectureId: participantSessions.lectureId }).from(participantSessions).where(inArray(participantSessions.lectureId, lectureIds))
        : []
    ]);

    const seriesEventRows = lectureIds.length > 0
      ? await this.db
          .select({
            event: analyticsEvents,
            lecture: lectures,
            participant: participantSessions
          })
          .from(analyticsEvents)
          .leftJoin(lectures, eq(analyticsEvents.lectureId, lectures.id))
          .leftJoin(participantSessions, eq(analyticsEvents.participantSessionId, participantSessions.id))
          .where(inArray(analyticsEvents.lectureId, lectureIds))
          .orderBy(desc(analyticsEvents.occurredAt))
      : [];

    const events = eventRows.map((row) => ({
      id: row.event.id,
      lectureToken: row.lecture?.publicToken,
      eventType: row.event.eventType,
      payload: row.event.eventPayload as Record<string, unknown>,
      anonymousKey: row.participant?.anonymousKey,
      pseudonym: row.participant?.pseudonym,
      occurredAt: row.event.occurredAt.toISOString()
    }));
    const seriesEvents = seriesEventRows.map((row) => ({
      id: row.event.id,
      lectureToken: row.lecture?.publicToken,
      eventType: row.event.eventType,
      payload: row.event.eventPayload as Record<string, unknown>,
      anonymousKey: row.participant?.anonymousKey,
      pseudonym: row.participant?.pseudonym,
      occurredAt: row.event.occurredAt.toISOString()
    }));
    const participantCounts = new Map<string, number>();
    for (const participant of seriesParticipantRows) {
      participantCounts.set(participant.lectureId, (participantCounts.get(participant.lectureId) ?? 0) + 1);
    }
    const seriesTrend = buildSeriesTrendSummary({
      seriesTitle: currentLecture?.seriesTitle ?? undefined,
      currentLectureId: input.lectureId,
      lectures: seriesLectureRows.map((lecture) => ({
        lectureId: lecture.id,
        lectureToken: lecture.publicToken,
        lectureTitle: lecture.title,
        liveAt: lecture.liveAt?.toISOString() ?? new Date(0).toISOString()
      })),
      events: seriesEvents,
      participantCounts
    });

    const chatQuestions = chatQuestionRows.map((row) => ({
      text: row.questionText,
      status: row.status === "accepted" ? "accepted" as const : "ignored" as const,
      pseudonym: row.pseudonym,
      relevanceReason: row.relevanceReason,
      sourceTopic: row.sourceTopic ?? undefined,
      createdAt: row.createdAt.toISOString()
    }));

    return buildSummary({
      ...input,
      seriesTitle: currentLecture?.seriesTitle ?? undefined,
      events,
      chatQuestions,
      participantCount: participantRows.length,
      seriesTrend
    });
  }

  async getLectureLeaderboard(input: { lectureId: string; lectureToken: string; currentAnonymousKey?: string }) {
    const rows = await this.db
      .select({
        event: analyticsEvents,
        participant: participantSessions
      })
      .from(analyticsEvents)
      .leftJoin(participantSessions, eq(analyticsEvents.participantSessionId, participantSessions.id))
      .where(and(eq(analyticsEvents.lectureId, input.lectureId), eq(analyticsEvents.eventType, "answer_selected")))
      .orderBy(desc(analyticsEvents.occurredAt));

    const events = rows.map((row) => ({
      id: row.event.id,
      lectureToken: input.lectureToken,
      eventType: row.event.eventType,
      payload: row.event.eventPayload as Record<string, unknown>,
      anonymousKey: row.participant?.anonymousKey,
      pseudonym: row.participant?.pseudonym,
      occurredAt: row.event.occurredAt.toISOString()
    }));

    return buildLeaderboardEntries(events, input.currentAnonymousKey);
  }

  private async findOrCreateParticipantSession(input: { lectureId: string; anonymousKey: string; pseudonym: string }) {
    const [session] = await this.db
      .insert(participantSessions)
      .values({
        lectureId: input.lectureId,
        anonymousKey: input.anonymousKey,
        pseudonym: input.pseudonym
      })
      .onConflictDoUpdate({
        target: [participantSessions.lectureId, participantSessions.anonymousKey],
        set: {
          pseudonym: input.pseudonym,
          lastSeenAt: new Date()
        }
      })
      .returning({ id: participantSessions.id });

    return session.id;
  }
}

export function getAnalyticsRepository(): AnalyticsRepository {
  if (process.env.LEARNBUDDY_REPOSITORY !== "local" && process.env.DATABASE_URL) {
    return new PostgresAnalyticsRepository();
  }

  return new LocalAnalyticsRepository();
}
