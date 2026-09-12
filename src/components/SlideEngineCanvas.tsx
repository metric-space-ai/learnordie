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
import { LectureJoinSlide } from "./LectureJoinSlide";

export function SlideEngineCanvas({
  slides,
  slideDocument: storedSlideDocument,
  current,
  lectureToken,
  lectureTitle,
  showJoinIntro = false,
  navigationDisabled = false,
  onPrevious,
  onNext
}: {
  slides: Slide[];
  slideDocument?: SlideDocument;
  current: number;
  lectureToken?: string;
  lectureTitle?: string;
  showJoinIntro?: boolean;
  navigationDisabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const lectureUrl = lectureToken ? `${origin}/l/${encodeURIComponent(lectureToken)}` : "";
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
      if (navigationDisabled) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };

    window.document.addEventListener("keydown", onKey);
    return () => window.document.removeEventListener("keydown", onKey);
  }, [onNext, onPrevious, navigationDisabled]);

  return (
    <>
      <article
        className="slide-engine-stage lb-enter-stage"
        data-direction={direction}
        data-slide-engine="v1"
        data-slide-id={showJoinIntro ? "lecture-join" : currentSlide.id}
      >
        {lectureUrl && <a className="slide-lecture-link" href={lectureUrl} aria-label={`Link zur Vorlesung: ${lectureUrl}`}>{lectureUrl}</a>}
        {showJoinIntro && lectureUrl ? (
          <LectureJoinSlide url={lectureUrl} title={lectureTitle ?? "Zur Vorlesung"} onStart={navigationDisabled ? undefined : onNext} />
        ) : <DeckRenderer
          className="slide-engine-deck"
          currentSlideId={currentSlide.id}
          document={activeSlideDocument}
          renderAsset={renderLegacyDiagramAsset}
          renderMode="current"
        />}
      </article>
      <nav className="slide-nav slide-engine-nav lb-enter-control" aria-label="Foliennavigation">
        <button type="button" disabled={navigationDisabled} onClick={onPrevious} aria-label="Vorherige Folie">‹</button>
        <span className="slide-count">{showJoinIntro ? "Beitreten" : `${current + 1} / ${slides.length}`}</span>
        <button type="button" disabled={navigationDisabled} onClick={onNext} aria-label="Nächste Folie">›</button>
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
