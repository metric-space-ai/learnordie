// Readiness service (parallel-product-plan §8.2 / Agent A1).
//
// Readiness is a MOTIVATIONAL self-assessment, never a grade or an exam promise.
// It is computed from real interaction signals (answers per level, coverage of past
// lectures, learn activity). The module is pure so it is easy to test and reuse from
// both the local and Postgres student repositories.

import type {
  QuestionLevel,
  ReadinessBand,
  ReadinessLevelBreakdown,
  ReadinessNextAction,
  ReadinessSnapshot,
  ReadinessTopicBreakdown,
  StudentProfile
} from "@/lib/types";

export type ReadinessAnswerSignal = {
  lectureToken: string;
  level: QuestionLevel;
  correct: boolean;
};

export type ReadinessLectureInput = {
  lectureId: string;
  publicToken: string;
  title: string;
  isPast: boolean; // learn-available / already happened
  isLive: boolean;
  isUpcoming: boolean;
};

export type ReadinessComputeInput = {
  profile: StudentProfile;
  seriesId: string;
  seriesTitle: string;
  lectures: ReadinessLectureInput[];
  answers: ReadinessAnswerSignal[];
  learnMarkerCount?: number;
};

const LEVELS: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];

// Higher levels are harder, so a correct answer there contributes more to confidence.
const LEVEL_WEIGHT: Record<QuestionLevel, number> = {
  "4.0": 1,
  "3.0": 1.3,
  "2.0": 1.7,
  "1.0": 2
};

const BAND_LABELS: Record<ReadinessBand, string> = {
  start: "Startklar",
  auf_kurs: "Auf Kurs",
  fast_bereit: "Fast bereit",
  bereit: "Bereit"
};

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function bandForScore(score: number): ReadinessBand {
  if (score >= 85) return "bereit";
  if (score >= 65) return "fast_bereit";
  if (score >= 40) return "auf_kurs";
  return "start";
}

export function computeReadinessSnapshot(input: ReadinessComputeInput): ReadinessSnapshot {
  const { profile, seriesId, seriesTitle, lectures, answers } = input;
  const learnMarkerCount = input.learnMarkerCount ?? 0;
  const computedAt = new Date().toISOString();

  const pastLectures = lectures.filter((lecture) => lecture.isPast);
  const liveLecture = lectures.find((lecture) => lecture.isLive);

  // Per-level breakdown.
  const byLevel: ReadinessLevelBreakdown[] = LEVELS.map((level) => {
    const levelAnswers = answers.filter((answer) => answer.level === level);
    const correct = levelAnswers.filter((answer) => answer.correct).length;
    return {
      level,
      answers: levelAnswers.length,
      correct,
      correctRate: pct(correct, levelAnswers.length)
    };
  });

  // Per-topic breakdown == per past lecture (each lecture is a coherent topic).
  const byTopic: ReadinessTopicBreakdown[] = pastLectures
    .map((lecture) => {
      const lectureAnswers = answers.filter((answer) => answer.lectureToken === lecture.publicToken);
      const correct = lectureAnswers.filter((answer) => answer.correct).length;
      const correctRate = pct(correct, lectureAnswers.length);
      return {
        topic: lecture.title,
        answers: lectureAnswers.length,
        correctRate,
        needsReview: lectureAnswers.length >= 2 && correctRate < 60
      };
    })
    .filter((topic) => topic.answers > 0);

  // Weighted accuracy across all answered levels.
  let weightedCorrect = 0;
  let weightedTotal = 0;
  for (const answer of answers) {
    const weight = LEVEL_WEIGHT[answer.level] ?? 1;
    weightedTotal += weight;
    if (answer.correct) weightedCorrect += weight;
  }
  const accuracy = weightedTotal > 0 ? (weightedCorrect / weightedTotal) * 100 : 0;

  // Coverage = how many of the available questions across past lectures were answered.
  // Each lecture exposes 4 question levels. This prevents a single correct answer from
  // implying full readiness — breadth matters as much as accuracy.
  const QUESTIONS_PER_LECTURE = 4;
  const availableQuestions = pastLectures.length * QUESTIONS_PER_LECTURE;
  const answeredQuestions = answers.length;
  const coverage = availableQuestions > 0
    ? Math.min(100, pct(answeredQuestions, availableQuestions))
    : answeredQuestions > 0
      ? 100
      : 0;

  const coveredLectureCount = pastLectures.filter((lecture) =>
    answers.some((answer) => answer.lectureToken === lecture.publicToken)
  ).length;

  const activityBonus = Math.min(100, learnMarkerCount * 8 + answeredQuestions * 2);

  const readinessScore = answeredQuestions === 0 && learnMarkerCount === 0
    ? 0
    : Math.max(0, Math.min(100, Math.round(0.5 * coverage + 0.35 * accuracy + 0.15 * activityBonus)));

  const band = bandForScore(readinessScore);

  const strengths = byTopic
    .filter((topic) => topic.answers >= 2 && topic.correctRate >= 80)
    .map((topic) => topic.topic);

  const reviewTopics = byTopic
    .filter((topic) => topic.needsReview)
    .sort((left, right) => left.correctRate - right.correctRate)
    .map((topic) => topic.topic);

  // Next actions: concrete, "next sensible unit" — not a generic to-do list.
  const nextActions: ReadinessNextAction[] = [];
  if (liveLecture) {
    nextActions.push({
      id: `live-${liveLecture.lectureId}`,
      kind: "live",
      title: `Jetzt live: ${liveLecture.title}`,
      detail: "Diese Veranstaltung läuft gerade. Direkt teilnehmen lohnt sich am meisten.",
      lectureToken: liveLecture.publicToken
    });
  }

  for (const topicName of reviewTopics.slice(0, 2)) {
    const lecture = pastLectures.find((item) => item.title === topicName);
    if (!lecture) continue;
    nextActions.push({
      id: `review-${lecture.lectureId}`,
      kind: "review",
      title: `Wiederhole „${topicName}"`,
      detail: "Hier waren noch einige Antworten daneben — eine kurze Lern-Runde festigt das Thema.",
      lectureToken: lecture.publicToken
    });
  }

  if (nextActions.length === 0) {
    const answeredInLecture = (token: string) => answers.filter((answer) => answer.lectureToken === token).length;
    const uncovered = pastLectures.find((lecture) => answeredInLecture(lecture.publicToken) === 0);
    const partiallyCovered = pastLectures.find(
      (lecture) => answeredInLecture(lecture.publicToken) > 0 && answeredInLecture(lecture.publicToken) < QUESTIONS_PER_LECTURE
    );
    if (uncovered) {
      nextActions.push({
        id: `learn-${uncovered.lectureId}`,
        kind: "learn",
        title: `Starte mit „${uncovered.title}"`,
        detail: "Diese vergangene Veranstaltung hast du noch nicht geübt.",
        lectureToken: uncovered.publicToken
      });
    } else if (partiallyCovered) {
      nextActions.push({
        id: `continue-${partiallyCovered.lectureId}`,
        kind: "learn",
        title: `Übe weiter in „${partiallyCovered.title}"`,
        detail: "Es warten noch weitere Fragen auf dich — ein paar mehr festigen das Thema.",
        lectureToken: partiallyCovered.publicToken
      });
    } else if (answers.length === 0) {
      const upcoming = lectures.find((lecture) => lecture.isUpcoming);
      nextActions.push({
        id: "plan",
        kind: "learn",
        title: upcoming ? `Plane „${upcoming.title}"` : "Lege los",
        detail: "Sobald du an einer Veranstaltung teilnimmst, entsteht hier dein Lernstand."
      });
    } else {
      nextActions.push({
        id: "keep-level",
        kind: "review",
        title: "Halte dein Niveau",
        detail: "Du bist gut vorbereitet. Eine kurze Wiederholung vor der Prüfung sichert das ab."
      });
    }
  }

  return {
    studentProfileId: profile.id,
    seriesId,
    seriesTitle,
    computedAt,
    readinessScore,
    band,
    bandLabel: BAND_LABELS[band],
    answerRate: coverage,
    byLevel,
    byTopic,
    strengths,
    reviewTopics,
    nextActions,
    lectureCount: lectures.length,
    coveredLectureCount
  };
}
