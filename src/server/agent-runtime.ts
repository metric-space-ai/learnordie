import {
  runLearnordieAgentRuntime,
  type AgentRuntimeResult,
  type AgentThreadMode
} from "@learnordie/agent-runtime";

import {
  legacySlidesFromSlideDocument,
  normalizeLectureSlideDocument
} from "@/lib/slide-documents";
import type { Lecture } from "@/lib/types";
import type { SlideDocument } from "@learnordie/slide-engine";
import { getAIProvider } from "./providers/ai";

export type CreateAgentThreadRunInput = {
  lecture: Lecture;
  mode: AgentThreadMode;
  prompt: string;
  slideId?: string;
  blockId?: string;
  assetId?: string;
};

export type CreatedAgentThreadRun = AgentRuntimeResult & {
  document: SlideDocument;
};

export async function createAgentThreadRun(input: CreateAgentThreadRunInput): Promise<CreatedAgentThreadRun> {
  const document = normalizeLectureSlideDocument(input.lecture.slideDocument, {
    id: input.lecture.id,
    title: input.lecture.title,
    seriesTitle: input.lecture.seriesTitle,
    language: input.lecture.language,
    slides: input.lecture.slides
  });

  const result = await runLearnordieAgentRuntime({
    lecture: input.lecture,
    document,
    mode: input.mode,
    prompt: input.prompt,
    slideId: input.slideId,
    blockId: input.blockId,
    assetId: input.assetId,
    complete: async (request) => {
      const provider = getAIProvider();
      const response = await provider.complete(request);
      return {
        answer: response.answer,
        provider: provider.info.provider,
        model: provider.info.model,
        usage: response.usage
      };
    }
  });

  return {
    ...result,
    document
  };
}

export function applyAgentReviewPatchToLecture(lecture: Lecture, document: SlideDocument): Pick<Lecture, "slides" | "slideDocument"> {
  return {
    slideDocument: document,
    slides: legacySlidesFromSlideDocument(document, lecture.slides)
  };
}
