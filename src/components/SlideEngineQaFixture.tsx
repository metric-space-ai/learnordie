"use client";

import { useCallback, useState } from "react";

import type { Slide } from "@/lib/types";
import { SlideEngineCanvas } from "./SlideEngineCanvas";

export function SlideEngineQaFixture({ slides }: { slides: Slide[] }) {
  const [current, setCurrent] = useState(0);
  const previous = useCallback(
    () => setCurrent((index) => (index + slides.length - 1) % slides.length),
    [slides.length]
  );
  const next = useCallback(
    () => setCurrent((index) => (index + 1) % slides.length),
    [slides.length]
  );

  return (
    <main className="slide-screen lb-motion-root" data-slide-engine-qa="true">
      <SlideEngineCanvas
        current={current}
        onNext={next}
        onPrevious={previous}
        slides={slides}
      />
    </main>
  );
}
