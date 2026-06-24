import type { SlideAssetKind, SlideBBox, SlideDocument } from "@learnordie/slide-engine";

export type QuestionLevel = "4.0" | "3.0" | "2.0" | "1.0";
export type QuestionVariantReviewStatus = "draft" | "reviewed" | "approved" | "rejected";
export type LectureStatus =
  | "draft"
  | "material_processing"
  | "question_review"
  | "ready_for_live"
  | "live"
  | "learn_active"
  | "archived";

export type AnswerOption = {
  key: "A" | "B" | "C" | "D";
  text: string;
  correct: boolean;
};

export type QuestionPromptHistoryItem = {
  id: string;
  kind: "generation" | "edit" | "decision" | "template" | "test";
  title: string;
  promptVersion?: string;
  model?: string;
  actor?: string;
  inputSummary: string;
  outputSummary: string;
  createdAt: string;
};

export type QuestionPromptTestRun = {
  id: string;
  model: string;
  score: number;
  verdict: "stabil" | "prüfen" | "kritisch";
  inputSummary: string;
  outputSummary: string;
  latencyMs: number;
  estimatedCostEur: number;
  createdAt: string;
};

export type QuestionPromptModelComparison = {
  id: string;
  model: string;
  score: number;
  verdict: "stabil" | "prüfen" | "kritisch";
  latencyMs: number;
  estimatedCostEur: number;
  createdAt: string;
};

export type QuestionPromptRegistry = {
  templateId: string;
  templateTitle: string;
  templateBody?: string;
  promptVersion: string;
  model: string;
  modelParameters: {
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    retrievalMode: "vector" | "text" | "hybrid";
    sourceLimit: number;
  };
  qualityMetrics: {
    difficultyLevel: QuestionLevel;
    cognitiveTarget: string;
    sourceCoverage: number;
    reviewConfidence: number;
    revisionCount: number;
    lastDecision?: QuestionVariantReviewStatus;
  };
  testRuns?: QuestionPromptTestRun[];
  modelComparisons?: QuestionPromptModelComparison[];
  updatedAt: string;
};

export type QuestionQualityDecision = {
  status: QuestionVariantReviewStatus;
  reason: string;
  decidedBy: string;
  decidedAt: string;
};

export type QuestionVariant = {
  level: QuestionLevel;
  points: number;
  text: string;
  answers: AnswerOption[];
  explanation: string;
  promptVersion?: string;
  sourceRef?: string;
  learningObjective?: string;
  reviewStatus?: QuestionVariantReviewStatus;
  reviewerComment?: string;
  promptHistory?: QuestionPromptHistoryItem[];
  promptRegistry?: QuestionPromptRegistry;
  qualityDecision?: QuestionQualityDecision;
};

export type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  topic: string;
  copy: string[];
  diagram: "bearing" | "formula" | "ramp";
};

export type LectureMaterial = {
  id: string;
  lectureId: string;
  kind: "pptx" | "pdf" | "url" | "notes" | "audio" | "other";
  source: "upload" | "url" | "notes";
  originalName: string;
  storageUrl: string;
  sizeBytes?: number;
  status: "uploaded" | "processing" | "ready";
  chunkCount?: number;
  extractedTextPreview?: string;
  sourceRefs?: string[];
  createdAt: string;
};

export type PresentationAssetSource = {
  materialId?: string;
  originalName: string;
  sourceRef?: string;
  page?: number;
  slide?: number;
  bbox?: SlideBBox;
};

export type PresentationAssetQuality = {
  extractionConfidence?: number;
  needsReview: boolean;
  reason?: string;
};

export type PresentationAsset = {
  id: string;
  lectureId: string;
  kind: SlideAssetKind;
  title: string;
  description?: string;
  storageKey?: string;
  previewKey?: string;
  extractedText?: string;
  structuredData?: unknown;
  source: PresentationAssetSource;
  tags: string[];
  quality: PresentationAssetQuality;
  createdAt: string;
};

export type MaterialProcessingRunStatus = "queued" | "running" | "succeeded" | "failed" | "dead_letter";
export type MaterialProcessingStepStatus = "running" | "done" | "failed" | "skipped";

export type MaterialProcessingStep = {
  label: string;
  status: MaterialProcessingStepStatus;
  detail?: string;
  at: string;
};

export type MaterialProcessingRun = {
  id: string;
  lectureId: string;
  status: MaterialProcessingRunStatus;
  materialCount: number;
  chunkCount: number;
  reviewCount: number;
  attemptCount?: number;
  maxAttempts?: number;
  provider?: string;
  providerJobId?: string;
  message?: string;
  steps: MaterialProcessingStep[];
  nextAttemptAt?: string;
  deadLetterAt?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

export type StudentChatQuestionStatus = "accepted" | "ignored";

export type StudentChatQuestion = {
  id: string;
  lectureId: string;
  pseudonym: string;
  anonymousKey?: string;
  text: string;
  status: StudentChatQuestionStatus;
  relevanceReason: string;
  sourceTopic?: string;
  moderationProvider?: string;
  moderationModel?: string;
  moderationConfidence?: number;
  moderationSignals?: string[];
  createdAt: string;
};

export type TranscriptSegmentStatus = "accepted" | "ignored";

export type TranscriptSegment = {
  id: string;
  lectureId: string;
  text: string;
  provider: string;
  status: TranscriptSegmentStatus;
  relevanceReason: string;
  sourceTopic?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
};

export type LecturerAssistantMessageRole = "lecturer" | "assistant";

export type LecturerAssistantAgentStepStatus = "done" | "suggested" | "blocked";

export type LecturerAssistantAgentStep = {
  title: string;
  detail: string;
  status: LecturerAssistantAgentStepStatus;
};

export type LecturerAssistantSourceWeight = {
  label: string;
  weight: number;
  reason: string;
};

export type LecturerAssistantToolSuggestion = {
  action: "review_draft" | "slide_point" | "source_note" | "evaluation_focus" | "learn_density";
  label: string;
  reason: string;
};

export type LecturerAssistantToolPlanItem = LecturerAssistantToolSuggestion & {
  order: number;
  status: "suggested" | "blocked";
  prerequisite?: string;
};

export type LecturerAssistantMetadata = {
  provider?: string;
  model?: string;
  agentRunId?: string;
  strategy?: string;
  steps?: LecturerAssistantAgentStep[];
  sourceWeights?: LecturerAssistantSourceWeight[];
  toolSuggestions?: LecturerAssistantToolSuggestion[];
  toolPlan?: LecturerAssistantToolPlanItem[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export type LecturerAssistantMessage = {
  id: string;
  lectureId: string;
  role: LecturerAssistantMessageRole;
  content: string;
  slideId?: string;
  sourceRefs?: string[];
  metadata?: LecturerAssistantMetadata;
  createdAt: string;
};

export type StandaloneExport = {
  id: string;
  lectureId: string;
  version: string;
  storageUrl?: string;
  sha256?: string;
  createdAt: string;
};

export type StandaloneExportJobStatus = "queued" | "running" | "succeeded" | "failed" | "dead_letter";

export type StandaloneExportJob = {
  id: string;
  lectureId: string;
  status: StandaloneExportJobStatus;
  format: "archive_zip";
  requestedBy?: string;
  attemptCount?: number;
  maxAttempts?: number;
  provider?: string;
  providerJobId?: string;
  standaloneExportId?: string;
  storageUrl?: string;
  sha256?: string;
  message?: string;
  nextAttemptAt?: string;
  deadLetterAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  createdAt: string;
};

export type EvaluationConfig = {
  enabled: boolean;
  version: number;
  updatedAt: string;
  title: string;
  intro: string;
  understandingLabel: string;
  paceLabel: string;
  aiHelpfulLabel: string;
  commentLabel: string;
  submitLabel: string;
};

export type QuestionReviewStatus = "draft" | "approved" | "rejected";

export type QuestionReviewItem = {
  id: string;
  lectureId: string;
  sourceMaterialId?: string;
  sourceTitle: string;
  status: QuestionReviewStatus;
  variants: QuestionVariant[];
  createdAt: string;
  reviewedAt?: string;
};

export type Lecture = {
  id: string;
  publicToken: string;
  ownerEmail?: string;
  title: string;
  seriesTitle: string;
  language: "de";
  status: LectureStatus;
  liveAt: string;
  examDate: string;
  aiAccessUntil: string;
  aiDailyLimit: number;
  aiDailyTokenLimit: number;
  seriesAiDailyLimit: number;
  seriesAiDailyTokenLimit: number;
  tenantAiDailyLimit: number;
  tenantAiDailyTokenLimit: number;
  tenantBudgetKey: string;
  leaderboardEnabled: boolean;
  learnQuestionDensity: number;
  evaluationConfig: EvaluationConfig;
  slides: Slide[];
  slideDocument?: SlideDocument;
  questions: QuestionVariant[];
  materials?: LectureMaterial[];
  presentationAssets?: PresentationAsset[];
  questionReviews?: QuestionReviewItem[];
  materialProcessingRuns?: MaterialProcessingRun[];
  studentChatQuestions?: StudentChatQuestion[];
  transcriptSegments?: TranscriptSegment[];
  assistantMessages?: LecturerAssistantMessage[];
  standaloneExports?: StandaloneExport[];
  standaloneExportJobs?: StandaloneExportJob[];
};

export type AnalyticsLevelSummary = {
  level: QuestionLevel;
  answers: number;
  correct: number;
  correctRate: number;
};

export type LeaderboardEntry = {
  rank: number;
  name: string;
  points: number;
  correct: number;
  answers: number;
  self?: boolean;
};

export type RetentionCountItem = {
  key: string;
  label: string;
  count: number;
};

export type RetentionPolicyDetails = {
  schemaVersion: string;
  years: number;
  cutoffAt: string;
  asOf: string;
  pseudonymousLearningSignals: {
    defaultYears: number;
    years: number;
    cleanupAction: string;
    autoCleanup: boolean;
    tables: string[];
    description: string;
  };
  courseContent: {
    retentionClass: string;
    minimumYears: number | null;
    autoCleanup: boolean;
    tables: string[];
    description: string;
  };
  standaloneArtifacts: {
    retentionClass: string;
    minimumYears: number;
    autoCleanup: boolean;
    tables: string[];
    description: string;
  };
  qualityAggregates: {
    retentionClass: string;
    minimumYears: number;
    autoCleanup: boolean;
    description: string;
  };
};

export type RetentionSummary = {
  lectureId: string;
  lectureToken: string;
  policy: RetentionPolicyDetails;
  staleTotal: number;
  cleanupTotal: number;
  contentTotal: number;
  counts: RetentionCountItem[];
  recommendation: string;
  mode: "postgres" | "local";
};

export type AnalyticsQuestionQualityItem = {
  questionText: string;
  level?: QuestionLevel;
  answers: number;
  correct: number;
  correctRate: number;
  wrong: number;
  mostSelectedWrong?: string;
  recommendation: string;
};

export type AnalyticsActivityBucket = {
  startAt: string;
  label: string;
  events: number;
  participants: number;
  answers: number;
  correct: number;
  correctRate: number;
  aiQuestions: number;
  evaluations: number;
};

export type AnalyticsTopicClusterItem = {
  topic: string;
  signalCount: number;
  answerCount: number;
  wrongAnswers: number;
  correctRate: number;
  aiQuestions: number;
  chatQuestions: number;
  acceptedChatQuestions: number;
  evaluationMentions: number;
  riskLevel: "hoch" | "mittel" | "beobachten";
  evidence: string[];
  recommendation: string;
};

export type AnalyticsSeriesTrendItem = {
  lectureId: string;
  lectureToken: string;
  lectureTitle: string;
  liveAt: string;
  participants: number;
  answers: number;
  correctRate: number;
  aiQuestions: number;
  evaluations: number;
  topTopic?: string;
  riskLevel?: "hoch" | "mittel" | "beobachten";
};

export type AnalyticsImprovementSuggestionItem = {
  id: string;
  priority: "hoch" | "mittel" | "beobachten";
  area: "Folie" | "Frage" | "Tempo" | "KI" | "Evaluation";
  title: string;
  evidence: string[];
  action: string;
  source: "topic_cluster" | "question_quality" | "series_trend" | "evaluation" | "ai_usage";
};

export type AnalyticsImprovementDiffField = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type AnalyticsImprovementHistoryItem = {
  id: string;
  occurredAt: string;
  kind: "slide" | "question";
  targetLabel: string;
  title: string;
  before: string;
  after: string;
  diff: AnalyticsImprovementDiffField[];
  suggestionId?: string;
};

export type AnalyticsImprovementImpactItem = {
  id: string;
  appliedAt: string;
  kind: "slide" | "question";
  targetLabel: string;
  title: string;
  beforeAnswers: number;
  beforeCorrectRate: number;
  afterAnswers: number;
  afterCorrectRate: number;
  delta: number;
  status: "verbessert" | "stabil" | "kritisch" | "zu_wenig_daten";
  recommendation: string;
};

export type LectureAnalyticsSummary = {
  lectureId: string;
  lectureToken: string;
  participants: number;
  answers: number;
  correct: number;
  answerRate: number;
  correctRate: number;
  levels: AnalyticsLevelSummary[];
  aiUsage: {
    opened: number;
    messages: number;
    blocked: number;
    tokens: number;
    sourceCitations: number;
    lastPrompt?: string;
    cost: {
      provider: string;
      model: string;
      currency: "EUR";
      inputTokens: number;
      outputTokens: number;
      estimatedEur: number;
      inputEurPer1k: number;
      outputEurPer1k: number;
      warningEur: number;
      criticalEur: number;
      warningLevel: "ok" | "watch" | "critical";
      warning: string;
    };
  };
  questionQuality: {
    items: AnalyticsQuestionQualityItem[];
    recommendation: string;
  };
  activityTimeline: {
    buckets: AnalyticsActivityBucket[];
    recommendation: string;
  };
  topicClusters: {
    items: AnalyticsTopicClusterItem[];
    recommendation: string;
  };
  seriesTrend: {
    seriesTitle: string;
    items: AnalyticsSeriesTrendItem[];
    recommendation: string;
  };
  improvementSuggestions: {
    items: AnalyticsImprovementSuggestionItem[];
    recommendation: string;
  };
  improvementHistory: {
    items: AnalyticsImprovementHistoryItem[];
    recommendation: string;
  };
  improvementImpact: {
    items: AnalyticsImprovementImpactItem[];
    recommendation: string;
  };
  evaluation: {
    count: number;
    understandingAverage: number;
    paceAverage: number;
    aiHelpfulAverage: number;
    comments: string[];
    versions: Array<{
      version: number;
      title: string;
      count: number;
      understandingAverage: number;
      paceAverage: number;
      aiHelpfulAverage: number;
      lastSubmittedAt?: string;
    }>;
    recommendation: string;
  };
  lastEventAt?: string;
};

export type LecturerSession = {
  email: string;
  issuedAt: string;
  expiresAt?: number;
};

// ── Student / Enrollment / Join-Code product layer ──────────────────────────
//
// These objects model the real student-facing product (see parallel-product-plan §3).
// A `joinCode` is a human-readable, deliberately communicated product object and is
// distinct from the technical `publicToken`. Codes are normalized case-insensitively
// (see `@/lib/join-code`: `normalizeJoinCode`). The `seriesId` is the slug of the
// series title in local mode and the real `lecture_series.id` in Postgres mode.

export type JoinCodeScope = "series" | "lecture";

export type JoinCode = {
  id: string;
  code: string; // display form as entered, e.g. "ME1-GL-2026"
  normalizedCode: string; // upper-case, URL-safe, used for unique lookup
  scope: JoinCodeScope;
  seriesId?: string;
  lectureId?: string;
  createdByUserId?: string;
  enabled: boolean;
  startsAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type StudentProfile = {
  id: string;
  anonymousKey: string; // stable per-browser key; bridges to analytics answer events
  pseudonym: string; // never a real name
  emailHash?: string;
  locale: string;
  createdAt: string;
  lastSeenAt: string;
};

export type EnrollmentSource =
  | "code"
  | "direct_live_link"
  | "direct_learn_link"
  | "lecturer_invite";

export type EnrollmentStatus = "active" | "removed";

export type StudentEnrollment = {
  id: string;
  studentProfileId: string;
  seriesId: string;
  seriesTitle: string;
  lectureId?: string;
  joinCodeId?: string;
  source: EnrollmentSource;
  status: EnrollmentStatus;
  addedAt: string;
  lastOpenedAt?: string;
};

/** Which dashboard bucket an event currently belongs to. */
export type StudentEventBucket = "live" | "upcoming" | "learn";

export type StudentDashboardEvent = {
  lectureId: string;
  publicToken: string;
  title: string;
  status: LectureStatus;
  bucket: StudentEventBucket;
  liveAt: string;
  examDate: string;
  aiAccessUntil: string;
  aiAccessActive: boolean;
  liveAvailable: boolean;
  learnAvailable: boolean;
};

export type StudentDashboardSeries = {
  enrollmentId: string;
  seriesId: string;
  seriesTitle: string;
  language: string;
  examDate?: string;
  joinCode?: string;
  source: EnrollmentSource;
  addedAt: string;
  lastOpenedAt?: string;
  events: StudentDashboardEvent[];
  liveNow: StudentDashboardEvent[];
  upcoming: StudentDashboardEvent[];
  learn: StudentDashboardEvent[];
  readiness?: ReadinessSnapshot;
};

export type StudentDashboard = {
  profile: StudentProfile;
  hasEnrollments: boolean;
  series: StudentDashboardSeries[];
};

export type ResolvedJoinTarget = {
  joinCode: JoinCode;
  scope: JoinCodeScope;
  seriesId: string;
  seriesTitle: string;
  lectureId?: string;
  lectureToken?: string;
  lectureTitle?: string;
  lectureStatus?: LectureStatus;
};

export type ReadinessBand = "start" | "auf_kurs" | "fast_bereit" | "bereit";

export type ReadinessLevelBreakdown = {
  level: QuestionLevel;
  answers: number;
  correct: number;
  correctRate: number;
};

export type ReadinessTopicBreakdown = {
  topic: string;
  answers: number;
  correctRate: number;
  needsReview: boolean;
};

export type ReadinessNextAction = {
  id: string;
  kind: "live" | "learn" | "review";
  title: string;
  detail: string;
  lectureToken?: string;
};

export type ReadinessSnapshot = {
  studentProfileId: string;
  seriesId: string;
  seriesTitle: string;
  computedAt: string;
  readinessScore: number; // 0-100, motivational self-assessment, NOT a grade
  band: ReadinessBand;
  bandLabel: string;
  answerRate: number;
  byLevel: ReadinessLevelBreakdown[];
  byTopic: ReadinessTopicBreakdown[];
  strengths: string[];
  reviewTopics: string[];
  nextActions: ReadinessNextAction[];
  lectureCount: number;
  coveredLectureCount: number;
};

/**
 * Anonymous, purpose-bound analytics events (parallel-product-plan §8.1).
 * Never store real names; `anonymousKey`/`pseudonym` only.
 */
export const STUDENT_ANALYTICS_EVENTS = [
  "student_profile_created",
  "join_code_resolved",
  "student_enrolled",
  "live_joined",
  "question_shown",
  "answer_selected",
  "answer_feedback_seen",
  "learn_marker_opened",
  "assistant_opened",
  "assistant_message_sent",
  "standalone_export_downloaded",
  "lecture_evaluation_started",
  "lecture_evaluation_submitted"
] as const;

export type StudentAnalyticsEventType = (typeof STUDENT_ANALYTICS_EVENTS)[number];
