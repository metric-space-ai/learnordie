import {
  legacySlidesToSlideDocument,
  slideDocumentToLegacySlides,
  validateSlideDocument,
  type SlideDocument
} from "@learnordie/slide-engine";

import type { Slide } from "./types";

export type LectureSlideDocumentInput = {
  id: string;
  title: string;
  seriesTitle?: string;
  language?: string;
  slides: Slide[];
};

export function buildLegacyLectureSlideDocument(input: LectureSlideDocumentInput): SlideDocument {
  return legacySlidesToSlideDocument(input.slides, {
    id: `lecture:${input.id}:deck`,
    title: input.seriesTitle ? `${input.seriesTitle}: ${input.title}` : input.title,
    language: input.language ?? "de",
    theme: "learnordie-technical"
  });
}

export function normalizeLectureSlideDocument(
  value: unknown,
  fallback: LectureSlideDocumentInput
): SlideDocument {
  const parsed = validateSlideDocument(value);
  if (parsed.ok) return parsed.document;
  return buildLegacyLectureSlideDocument(fallback);
}

export function validateLectureSlideDocument(value: unknown): SlideDocument | null {
  const parsed = validateSlideDocument(value);
  return parsed.ok ? parsed.document : null;
}

export function legacySlidesFromSlideDocument(document: SlideDocument, fallbackSlides: Slide[]): Slide[] {
  return slideDocumentToLegacySlides(document, fallbackSlides);
}
