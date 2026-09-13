"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Slide } from "@/lib/types";
import {
  legacySlidesToSlideDocument,
  type SlideDocument
} from "@learnordie/slide-engine";
import { canvasSceneForSlide } from "@learnordie/slide-engine/excalidraw/scene";
import { ExcalidrawCanvas } from "./excalidraw/ExcalidrawCanvas";
import { LectureJoinSlide } from "./LectureJoinSlide";

export function SlideEngineCanvas({
  slides,
  slideDocument: storedSlideDocument,
  current,
  lectureToken,
  lectureTitle,
  showJoinIntro = false,
  joinAction,
  navigationDisabled = false,
  showNavigation = true,
  onPrevious,
  onNext
}: {
  slides: Slide[];
  slideDocument?: SlideDocument;
  current: number;
  lectureToken?: string;
  lectureTitle?: string;
  showJoinIntro?: boolean;
  joinAction?: ReactNode;
  navigationDisabled?: boolean;
  showNavigation?: boolean;
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
  const canvasScene = useMemo(() => canvasSceneForSlide(
    activeSlideDocument.slides[current] ?? activeSlideDocument.slides[0], activeSlideDocument.assets
  ), [activeSlideDocument, current]);

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
          <LectureJoinSlide url={lectureUrl} title={lectureTitle ?? "Zur Vorlesung"} onStart={navigationDisabled ? undefined : onNext} action={joinAction} />
        ) : <ExcalidrawCanvas key={currentSlide.id} slideId={currentSlide.id} scene={canvasScene} assets={activeSlideDocument.assets} title={currentSlide.title} readOnly />}
      </article>
      {showNavigation && <nav className="slide-nav slide-engine-nav lb-enter-control" aria-label="Foliennavigation">
        <button type="button" disabled={navigationDisabled} onClick={onPrevious} aria-label="Vorherige Folie">‹</button>
        <span className="slide-count">{showJoinIntro ? "Beitreten" : `${current + 1} / ${slides.length}`}</span>
        <button type="button" disabled={navigationDisabled} onClick={onNext} aria-label="Nächste Folie">›</button>
      </nav>}
    </>
  );
}
