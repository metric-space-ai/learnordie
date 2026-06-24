"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Slide } from "@/lib/types";
import {
  DeckRenderer,
  legacyDiagramAssetId,
  legacySlidesToSlideDocument,
  type SlideDocument
} from "@learnordie/slide-engine";
import type { SlideAsset } from "@learnordie/slide-engine/components";
import { Diagram } from "./Diagram";

export function SlideEngineCanvas({
  slides,
  slideDocument: storedSlideDocument,
  current,
  onPrevious,
  onNext
}: {
  slides: Slide[];
  slideDocument?: SlideDocument;
  current: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const currentSlide = slides[current];
  const previousCurrent = useRef(current);
  const [direction, setDirection] = useState<"initial" | "next" | "previous">("initial");
  const activeSlideDocument = useMemo(
    () => storedSlideDocument ?? legacySlidesToSlideDocument(slides, {
      id: "legacy-live-deck",
      title: "Maschinenelemente I: Gleitlagerung",
      language: "de",
      theme: "learnordie-technical"
    }),
    [storedSlideDocument, slides]
  );

  useEffect(() => {
    const previous = previousCurrent.current;
    if (previous === current) return;

    const nextIndex = (previous + 1) % slides.length;
    setDirection(current === nextIndex ? "next" : "previous");
    previousCurrent.current = current;
  }, [current, slides.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };

    window.document.addEventListener("keydown", onKey);
    return () => window.document.removeEventListener("keydown", onKey);
  }, [onNext, onPrevious]);

  return (
    <>
      <article
        className="slide-engine-stage lb-enter-stage"
        data-direction={direction}
        data-slide-engine="v1"
        data-slide-id={currentSlide.id}
      >
        <DeckRenderer
          className="slide-engine-deck"
          currentSlideId={currentSlide.id}
          document={activeSlideDocument}
          renderAsset={renderLegacyDiagramAsset}
          renderMode="current"
        />
      </article>
      <nav className="slide-nav slide-engine-nav lb-enter-control" aria-label="Foliennavigation">
        <button type="button" onClick={onPrevious} aria-label="Vorherige Folie">‹</button>
        <span className="slide-count">{current + 1} / {slides.length}</span>
        <button type="button" onClick={onNext} aria-label="Nächste Folie">›</button>
      </nav>
    </>
  );
}

function renderLegacyDiagramAsset(asset: SlideAsset): ReactNode {
  if (asset.id === legacyDiagramAssetId("bearing")) return <Diagram type="bearing" />;
  if (asset.id === legacyDiagramAssetId("formula")) return <Diagram type="formula" />;
  if (asset.id === legacyDiagramAssetId("ramp")) return <Diagram type="ramp" />;
  return null;
}
