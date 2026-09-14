"use client";

import { useSyncExternalStore } from "react";
import type { CanvasScene } from "@learnordie/slide-engine/excalidraw/canvas-schema";
import type { SlideAssetRef } from "@learnordie/slide-engine/schema";
import { canvasReadingElements } from "@/lib/canvas-reading-layout";
import { ExcalidrawCanvas } from "./ExcalidrawCanvas";
import { CanvasEmbedContent } from "./CanvasEmbed";

const query = "(max-width: 600px)";
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};
const isNarrow = () => window.matchMedia(query).matches;
const serverNarrow = () => false;

export function SlideReaderCanvas({ scene, assets, title, slideId, mobileReading = false }: {
  scene: CanvasScene; assets: SlideAssetRef[]; title: string; slideId: string; mobileReading?: boolean;
}) {
  const narrow = useSyncExternalStore(subscribe, isNarrow, serverNarrow);
  const elements = mobileReading && narrow ? canvasReadingElements(scene, slideId) : null;
  if (!elements) return <ExcalidrawCanvas scene={scene} assets={assets} title={title} slideId={slideId} readOnly />;
  return <section className="native-canvas native-canvas-mobile" data-slide-id={slideId}
    data-canvas-engine="excalidraw-reflow" aria-label={`Folie: ${title}`} tabIndex={0}>
    {elements.map(element => element.type === "embeddable"
      ? <div key={element.id} className="mobile-slide-embed" data-canvas-embed-id={element.id}>
          <CanvasEmbedContent element={element} />
        </div>
      : element.id === `${slideId}:title`
        ? <h2 key={element.id}>{element.originalText ?? element.text}</h2>
        : <p key={element.id}>{element.originalText ?? element.text}</p>)}
  </section>;
}
