"use client";

import { useCallback, useMemo, useState } from "react";

import { DeckRenderer, type SlideDocument } from "@learnordie/slide-engine";

export function SlideEngineDocumentFixture({
  document,
  initialSlideId
}: {
  document: SlideDocument;
  initialSlideId?: string;
}) {
  const initialIndex = useMemo(() => {
    const index = document.slides.findIndex((slide) => slide.id === initialSlideId);
    return index >= 0 ? index : 0;
  }, [document.slides, initialSlideId]);
  const [current, setCurrent] = useState(initialIndex);
  const currentSlide = document.slides[current] ?? document.slides[0];
  const previous = useCallback(
    () => setCurrent((index) => (index + document.slides.length - 1) % document.slides.length),
    [document.slides.length]
  );
  const next = useCallback(
    () => setCurrent((index) => (index + 1) % document.slides.length),
    [document.slides.length]
  );

  return (
    <main className="slide-screen lb-motion-root" data-slide-engine-qa="blocks">
      <article
        className="slide-engine-stage lb-enter-stage"
        data-slide-engine="v1"
        data-slide-id={currentSlide.id}
      >
        <DeckRenderer
          className="slide-engine-deck"
          currentSlideId={currentSlide.id}
          document={document}
          renderMode="current"
        />
      </article>
      <nav className="slide-nav slide-engine-nav lb-enter-control" aria-label="Foliennavigation">
        <button type="button" onClick={previous} aria-label="Vorherige Folie">‹</button>
        <span className="slide-count">{current + 1} / {document.slides.length}</span>
        <button type="button" onClick={next} aria-label="Nächste Folie">›</button>
      </nav>
    </main>
  );
}
