"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { Slide } from "@/lib/types";
import { Diagram } from "./Diagram";

type MotionStyle = CSSProperties & Record<"--lb-i", number>;

export function SlideCanvas({
  slides,
  current,
  onPrevious,
  onNext
}: {
  slides: Slide[];
  current: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const slide = slides[current];
  const previousCurrent = useRef(current);
  const [direction, setDirection] = useState<"initial" | "next" | "previous">("initial");

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

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onNext, onPrevious]);

  return (
    <>
      <article className="slide lb-enter-stage" data-slide-id={slide.id}>
        <div className="slide-content" data-direction={direction} key={slide.id}>
          <div>
            <div className="slide-meta lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
              <span>{slide.eyebrow}</span>
              <span>Maschinenelemente I</span>
            </div>
            <h1 className="lb-enter-row" style={{ "--lb-i": 1 } as MotionStyle}>{slide.title}</h1>
          </div>
          <div className="slide-body">
            <div className="slide-copy">
              {slide.copy.map((line, index) => (
                <p
                  className="lb-enter-row"
                  key={line}
                  style={{ "--lb-i": index + 2 } as MotionStyle}
                >
                  {line}
                </p>
              ))}
            </div>
            <div className="diagram lb-enter-panel" aria-hidden="true" style={{ "--lb-i": slide.copy.length + 2 } as MotionStyle}>
              <Diagram type={slide.diagram} />
            </div>
          </div>
          <footer className="slide-foot">
            <span>{slide.topic}</span>
            <span>{current + 1} / {slides.length}</span>
          </footer>
        </div>
      </article>
      <nav className="slide-nav lb-enter-control" aria-label="Foliennavigation">
        <button type="button" onClick={onPrevious} aria-label="Vorherige Folie">‹</button>
        <span className="slide-count">{current + 1} / {slides.length}</span>
        <button type="button" onClick={onNext} aria-label="Nächste Folie">›</button>
      </nav>
    </>
  );
}
