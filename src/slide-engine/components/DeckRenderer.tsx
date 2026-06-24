import type { CSSProperties } from "react";

import { SlideRenderer } from "./SlideRenderer";
import type {
  SlideAssetCollection,
  SlideAssetRenderer,
  SlideAssetUrlResolver,
  SlideDocument
} from "./types";

export type DeckRendererProps = {
  document: SlideDocument;
  assets?: SlideAssetCollection;
  renderAsset?: SlideAssetRenderer;
  resolveAssetUrl?: SlideAssetUrlResolver;
  currentSlideId?: string;
  renderMode?: "all" | "current";
  className?: string;
  style?: CSSProperties;
};

const deckStyle: CSSProperties = {
  display: "grid",
  gap: 28,
  width: "100%",
  minWidth: 0,
  color: "var(--ink)"
};

const emptyDeckStyle: CSSProperties = {
  display: "grid",
  minHeight: 240,
  placeItems: "center",
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-stage)",
  background: "var(--panel)",
  color: "var(--muted)",
  fontWeight: 760
};

export function DeckRenderer({
  assets,
  className,
  currentSlideId,
  document,
  renderAsset,
  resolveAssetUrl,
  renderMode,
  style
}: DeckRendererProps) {
  const activeRenderMode = renderMode ?? (currentSlideId ? "current" : "all");
  const activeAssets = assets ?? document.assets;
  const slides = activeRenderMode === "current" ? currentSlide(document, currentSlideId) : document.slides;
  const showSlideNumber = document.deckSettings?.showSlideNumbers ?? true;

  if (document.slides.length === 0) {
    return (
      <section
        aria-label={document.title}
        className={["ld-deck-renderer", className].filter(Boolean).join(" ")}
        data-deck-id={document.id}
        data-schema-version={document.schemaVersion}
        style={{ ...deckStyle, ...style }}
      >
        <div style={emptyDeckStyle}>Empty slide deck</div>
      </section>
    );
  }

  return (
    <section
      aria-label={document.title}
      className={["ld-deck-renderer", className].filter(Boolean).join(" ")}
      data-deck-id={document.id}
      data-render-mode={activeRenderMode}
      data-schema-version={document.schemaVersion}
      data-theme={document.theme}
      style={{ ...deckStyle, ...style }}
    >
      {slides.map((slide) => {
        const slideIndex = document.slides.findIndex((candidate) => candidate.id === slide.id);

        return (
          <SlideRenderer
            aspect={document.aspect}
            assets={activeAssets}
            key={slide.id}
            renderAsset={renderAsset}
            resolveAssetUrl={resolveAssetUrl}
            showSlideNumber={showSlideNumber}
            slide={slide}
            slideCount={document.slides.length}
            slideNumber={slideIndex + 1}
          />
        );
      })}
    </section>
  );
}

function currentSlide(document: SlideDocument, currentSlideId: string | undefined) {
  if (!currentSlideId) return document.slides.slice(0, 1);
  return [document.slides.find((slide) => slide.id === currentSlideId) ?? document.slides[0]].filter(Boolean);
}
