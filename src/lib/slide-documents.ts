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

// Decks mit Bloecken ohne Legacy-Entsprechung (interaktive 3D-Szenen) duerfen nie
// aus Legacy-Folien neu aufgebaut werden, sonst gehen diese Bloecke verloren.
export function hasEngineOnlyBlocks(document: SlideDocument | undefined): document is SlideDocument {
  return Boolean(document?.slides.some((slide) => slide.blocks.some((block) => block.type === "scene3d")));
}

// Uebertraegt Legacy-Textaenderungen (Titel, Absaetze) in ein bestehendes Dokument,
// ohne Layout, Szenen, Notizen oder Quellen anzutasten.
export function mergeLegacySlideEditsIntoDocument(document: SlideDocument, slides: Slide[]): SlideDocument {
  const incoming = new Map(slides.map((slide) => [slide.id, slide]));
  const merged: SlideDocument = {
    ...document,
    slides: document.slides.map((node, index) => {
      const legacy = incoming.get(node.id) ?? slides[index];
      if (!legacy) return node;
      const title = legacy.title?.trim();
      let copyIndex = 0;
      const blocks = node.blocks.map((block) => {
        if (block.type !== "paragraph") return block;
        const text = legacy.copy?.[copyIndex++]?.trim();
        return text ? { ...block, text } : block;
      });
      return { ...node, title: title || node.title, blocks };
    })
  };
  const validated = validateSlideDocument(merged);
  return validated.ok ? validated.document : document;
}
