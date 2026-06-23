import type {
  Lecture,
  LectureMaterial,
  LectureStatus,
  QuestionVariant,
  Slide,
  StandaloneExport,
  StandaloneExportJob,
  StandaloneExportJobStatus,
  StudentChatQuestion,
  TranscriptSegment
} from "@/lib/types";
import { LocalLectureStore } from "./local-store";
import { PostgresLectureRepository } from "./postgres-repository";

export type CreateLectureInput = {
  title: string;
  seriesTitle: string;
  liveAt: string;
  examDate: string;
};

export type UpdateLectureInput = {
  title?: string;
  seriesTitle?: string;
  liveAt?: string;
  examDate?: string;
  status?: LectureStatus;
  aiDailyLimit?: number;
  aiDailyTokenLimit?: number;
  seriesAiDailyLimit?: number;
  seriesAiDailyTokenLimit?: number;
  tenantAiDailyLimit?: number;
  tenantAiDailyTokenLimit?: number;
  leaderboardEnabled?: boolean;
  learnQuestionDensity?: number;
  evaluationConfig?: unknown;
  saveEvaluationAsSeriesTemplate?: boolean;
  slides?: Slide[];
  questions?: QuestionVariant[];
};

export type AddMaterialInput = {
  kind: LectureMaterial["kind"];
  source: LectureMaterial["source"];
  originalName: string;
  storageUrl: string;
  sizeBytes?: number;
};

export type SubmitChatQuestionInput = {
  lectureToken: string;
  text: string;
  pseudonym: string;
  anonymousKey?: string;
};

export type CountRecentStudentChatQuestionsInput = {
  lectureToken: string;
  anonymousKey: string;
  since: Date;
};

export type ModerateChatQuestionInput = {
  lectureId: string;
  chatQuestionId: string;
  status: StudentChatQuestion["status"];
  actor?: string;
};

export type SubmitTranscriptSegmentInput = {
  lectureId: string;
  text: string;
  provider?: string;
  startedAt?: string;
  endedAt?: string;
};

export type SubmitLecturerAssistantMessageInput = {
  lectureId: string;
  message: string;
  slideId?: string;
};

export type CreateLecturerAssistantReviewInput = {
  lectureId: string;
  slideId?: string;
  message?: string;
};

export type ApplyLecturerAssistantSlidePointInput = {
  lectureId: string;
  slideId?: string;
  message?: string;
};

export type ApplyLecturerAssistantEvaluationFocusInput = {
  lectureId: string;
  slideId?: string;
  message?: string;
};

export type ApplyLecturerAssistantLearnDensityInput = {
  lectureId: string;
  slideId?: string;
  message?: string;
};

export type CreateLecturerAssistantSourceNoteInput = {
  lectureId: string;
  slideId?: string;
  originalName: string;
  storageUrl: string;
  sizeBytes?: number;
};

export type RecordStandaloneExportInput = {
  lectureId: string;
  version: string;
  storageUrl: string;
  sha256: string;
};

export type CreateStandaloneExportJobInput = {
  lectureId: string;
  format: StandaloneExportJob["format"];
  requestedBy?: string;
};

export type UpdateStandaloneExportJobInput = {
  status?: StandaloneExportJobStatus;
  standaloneExportId?: string;
  provider?: string;
  providerJobId?: string;
  storageUrl?: string;
  sha256?: string;
  message?: string;
  nextAttemptAt?: string;
  deadLetterAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export interface LectureRepository {
  listLectures(ownerEmail?: string): Promise<Lecture[]>;
  getLectureByToken(token: string): Promise<Lecture | null>;
  createLecture(input: CreateLectureInput, ownerEmail?: string): Promise<Lecture>;
  updateLecture(id: string, input: UpdateLectureInput, ownerEmail?: string): Promise<Lecture | null>;
  addMaterial(lectureId: string, input: AddMaterialInput, ownerEmail?: string): Promise<LectureMaterial | null>;
  processMaterials(lectureId: string, ownerEmail?: string): Promise<Lecture | null>;
  enqueueMaterialProcessingRun?(lectureId: string, ownerEmail?: string): Promise<Lecture | null>;
  countRecentStudentChatQuestions(input: CountRecentStudentChatQuestionsInput): Promise<number | null>;
  submitStudentChatQuestion(input: SubmitChatQuestionInput): Promise<StudentChatQuestion | null>;
  moderateStudentChatQuestion(input: ModerateChatQuestionInput, ownerEmail?: string): Promise<Lecture | null>;
  submitTranscriptSegment(input: SubmitTranscriptSegmentInput, ownerEmail?: string): Promise<TranscriptSegment | null>;
  submitLecturerAssistantMessage(input: SubmitLecturerAssistantMessageInput, ownerEmail?: string): Promise<Lecture | null>;
  createLecturerAssistantReview(input: CreateLecturerAssistantReviewInput, ownerEmail?: string): Promise<Lecture | null>;
  applyLecturerAssistantSlidePoint(input: ApplyLecturerAssistantSlidePointInput, ownerEmail?: string): Promise<Lecture | null>;
  applyLecturerAssistantEvaluationFocus(input: ApplyLecturerAssistantEvaluationFocusInput, ownerEmail?: string): Promise<Lecture | null>;
  applyLecturerAssistantLearnDensity(input: ApplyLecturerAssistantLearnDensityInput, ownerEmail?: string): Promise<Lecture | null>;
  createLecturerAssistantSourceNote(input: CreateLecturerAssistantSourceNoteInput, ownerEmail?: string): Promise<Lecture | null>;
  recordStandaloneExport(input: RecordStandaloneExportInput, ownerEmail?: string): Promise<StandaloneExport | null>;
  createStandaloneExportJob(input: CreateStandaloneExportJobInput, ownerEmail?: string): Promise<StandaloneExportJob | null>;
  updateStandaloneExportJob(jobId: string, input: UpdateStandaloneExportJobInput): Promise<StandaloneExportJob | null>;
  decideQuestionReview(lectureId: string, reviewId: string, decision: "approved" | "rejected", actor?: string, ownerEmail?: string): Promise<Lecture | null>;
  updateQuestionReview(lectureId: string, reviewId: string, variants: QuestionVariant[], actor?: string, ownerEmail?: string): Promise<Lecture | null>;
}

class LocalJsonLectureRepository implements LectureRepository {
  private store = new LocalLectureStore();

  async listLectures(ownerEmail?: string) {
    return this.store.listLectures(ownerEmail);
  }

  async getLectureByToken(token: string) {
    return this.store.getLectureByToken(token);
  }

  async createLecture(input: CreateLectureInput, ownerEmail?: string) {
    return this.store.createLecture(input, ownerEmail);
  }

  async updateLecture(id: string, input: UpdateLectureInput, ownerEmail?: string) {
    return this.store.updateLecture(id, input, ownerEmail);
  }

  async addMaterial(lectureId: string, input: AddMaterialInput, ownerEmail?: string) {
    return this.store.addMaterial(lectureId, input, ownerEmail);
  }

  async processMaterials(lectureId: string, ownerEmail?: string) {
    return this.store.processMaterials(lectureId, ownerEmail);
  }

  async countRecentStudentChatQuestions(input: CountRecentStudentChatQuestionsInput) {
    return this.store.countRecentStudentChatQuestions(input);
  }

  async submitStudentChatQuestion(input: SubmitChatQuestionInput) {
    return this.store.submitStudentChatQuestion(input);
  }

  async moderateStudentChatQuestion(input: ModerateChatQuestionInput, ownerEmail?: string) {
    return this.store.moderateStudentChatQuestion(input, ownerEmail);
  }

  async submitTranscriptSegment(input: SubmitTranscriptSegmentInput, ownerEmail?: string) {
    return this.store.submitTranscriptSegment(input, ownerEmail);
  }

  async submitLecturerAssistantMessage(input: SubmitLecturerAssistantMessageInput, ownerEmail?: string) {
    return this.store.submitLecturerAssistantMessage(input, ownerEmail);
  }

  async createLecturerAssistantReview(input: CreateLecturerAssistantReviewInput, ownerEmail?: string) {
    return this.store.createLecturerAssistantReview(input, ownerEmail);
  }

  async applyLecturerAssistantSlidePoint(input: ApplyLecturerAssistantSlidePointInput, ownerEmail?: string) {
    return this.store.applyLecturerAssistantSlidePoint(input, ownerEmail);
  }

  async applyLecturerAssistantEvaluationFocus(input: ApplyLecturerAssistantEvaluationFocusInput, ownerEmail?: string) {
    return this.store.applyLecturerAssistantEvaluationFocus(input, ownerEmail);
  }

  async applyLecturerAssistantLearnDensity(input: ApplyLecturerAssistantLearnDensityInput, ownerEmail?: string) {
    return this.store.applyLecturerAssistantLearnDensity(input, ownerEmail);
  }

  async createLecturerAssistantSourceNote(input: CreateLecturerAssistantSourceNoteInput, ownerEmail?: string) {
    return this.store.createLecturerAssistantSourceNote(input, ownerEmail);
  }

  async recordStandaloneExport(input: RecordStandaloneExportInput, ownerEmail?: string) {
    return this.store.recordStandaloneExport(input, ownerEmail);
  }

  async createStandaloneExportJob(input: CreateStandaloneExportJobInput, ownerEmail?: string) {
    return this.store.createStandaloneExportJob(input, ownerEmail);
  }

  async updateStandaloneExportJob(jobId: string, input: UpdateStandaloneExportJobInput) {
    return this.store.updateStandaloneExportJob(jobId, input);
  }

  async decideQuestionReview(lectureId: string, reviewId: string, decision: "approved" | "rejected", actor?: string, ownerEmail?: string) {
    return this.store.decideQuestionReview(lectureId, reviewId, decision, actor, ownerEmail);
  }

  async updateQuestionReview(lectureId: string, reviewId: string, variants: QuestionVariant[], actor?: string, ownerEmail?: string) {
    return this.store.updateQuestionReview(lectureId, reviewId, variants, actor, ownerEmail);
  }
}

export function getLectureRepository(): LectureRepository {
  if (process.env.LEARNBUDDY_REPOSITORY !== "local" && process.env.DATABASE_URL) {
    return new PostgresLectureRepository();
  }

  return new LocalJsonLectureRepository();
}
