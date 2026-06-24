import type { CSSProperties } from "react";

import { BlockRenderer } from "./BlockRenderer";
import type {
  SlideAspect,
  SlideAssetCollection,
  SlideAssetRenderer,
  SlideAssetUrlResolver,
  SlideBlock,
  SlideNode
} from "./types";

export type SlideRendererProps = {
  slide: SlideNode;
  aspect?: SlideAspect;
  assets?: SlideAssetCollection;
  renderAsset?: SlideAssetRenderer;
  resolveAssetUrl?: SlideAssetUrlResolver;
  slideNumber?: number;
  slideCount?: number;
  showSlideNumber?: boolean;
  className?: string;
  style?: CSSProperties;
};

type SlideLayoutMode = "center" | "focus" | "split" | "stack";

const aspectRatioBySlideAspect: Record<SlideAspect, string> = {
  "16:10": "16 / 10",
  "16:9": "16 / 9",
  "4:3": "4 / 3"
};

const slideShellStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  width: "100%",
  minWidth: 0,
  overflow: "hidden",
  padding: "clamp(28px, 5vw, 72px)",
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-stage)",
  background:
    "linear-gradient(90deg, oklch(72% 0.024 230 / 0.055) 1px, transparent 1px), linear-gradient(180deg, oklch(72% 0.024 230 / 0.055) 1px, transparent 1px), var(--slide)",
  backgroundSize: "42px 42px, 42px 42px, auto",
  boxShadow: "var(--shadow)",
  color: "var(--ink)",
  isolation: "isolate"
};

const slideInnerStyle: CSSProperties = {
  display: "grid",
  minHeight: 0,
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  gap: "clamp(18px, 3vw, 40px)"
};

const metaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  color: "var(--muted)",
  fontSize: 13,
  fontWeight: 760,
  lineHeight: 1.2
};

const titleStyle: CSSProperties = {
  maxWidth: 920,
  margin: "12px 0 0",
  color: "var(--ink)",
  fontSize: "clamp(34px, 5vw, 68px)",
  fontWeight: 880,
  letterSpacing: 0,
  lineHeight: 1.04
};

const stackBodyStyle: CSSProperties = {
  alignContent: "center",
  display: "grid",
  gap: "clamp(18px, 2.4vw, 30px)",
  minWidth: 0
};

const centerBodyStyle: CSSProperties = {
  ...stackBodyStyle,
  alignContent: "center",
  justifyItems: "center",
  textAlign: "center"
};

const splitBodyStyle: CSSProperties = {
  alignItems: "center",
  display: "grid",
  gap: "clamp(24px, 5vw, 68px)",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
  minWidth: 0
};

const columnStyle: CSSProperties = {
  alignContent: "center",
  display: "grid",
  gap: "clamp(16px, 2vw, 26px)",
  minWidth: 0
};

const footerStyle: CSSProperties = {
  ...metaStyle,
  alignSelf: "end"
};

export function SlideRenderer({
  aspect = "16:9",
  assets,
  className,
  renderAsset,
  resolveAssetUrl,
  showSlideNumber = true,
  slide,
  slideCount,
  slideNumber,
  style
}: SlideRendererProps) {
  const layoutMode = getLayoutMode(slide.layout);
  const bodyBlocks = visibleBodyBlocks(slide);
  const body = renderSlideBody(slide, bodyBlocks, layoutMode, assets, renderAsset, resolveAssetUrl);

  return (
    <section
      aria-label={slide.title}
      className={["ld-slide-renderer", className].filter(Boolean).join(" ")}
      data-intent={slide.intent}
      data-layout={slide.layout}
      data-slide-id={slide.id}
      style={{ ...slideShellStyle, aspectRatio: aspectRatioBySlideAspect[aspect], ...style }}
    >
      <div style={slideInnerStyle}>
        <header>
          <h1 data-slide-title style={titleStyle}>{slide.title}</h1>
        </header>
        {body}
        <footer style={footerStyle}>
          <span>{sourceSummary(slide.sourceRefs?.length ?? 0)}</span>
          {showSlideNumber && slideNumber && slideCount ? (
            <span>
              {slideNumber} / {slideCount}
            </span>
          ) : (
            <span />
          )}
        </footer>
      </div>
    </section>
  );
}

function renderSlideBody(
  slide: SlideNode,
  blocks: SlideBlock[],
  layoutMode: SlideLayoutMode,
  assets: SlideAssetCollection | undefined,
  renderAsset: SlideAssetRenderer | undefined,
  resolveAssetUrl: SlideAssetUrlResolver | undefined
) {
  if (layoutMode === "center") {
    return (
      <div style={centerBodyStyle}>
        {blocks.map((block) => (
          <BlockRenderer
            assets={assets}
            block={block}
            key={block.id}
            renderAsset={renderAsset}
            resolveAssetUrl={resolveAssetUrl}
          />
        ))}
      </div>
    );
  }

  if (layoutMode === "split") {
    const visualBlocks = blocks.filter(isVisualBlock);
    const textBlocks = blocks.filter((block) => !isVisualBlock(block));
    const orderedColumns =
      slide.layout === "technical_figure_left"
        ? [visualBlocks, textBlocks]
        : [textBlocks, visualBlocks];

    if (visualBlocks.length > 0 && textBlocks.length > 0) {
      return (
        <div style={splitBodyStyle}>
          {orderedColumns.map((blocks, index) => (
            <div key={index} style={columnStyle}>
              {blocks.map((block) => (
                <BlockRenderer
                  assets={assets}
                  block={block}
                  key={block.id}
                  renderAsset={renderAsset}
                  resolveAssetUrl={resolveAssetUrl}
                />
              ))}
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <div style={layoutMode === "focus" ? centerBodyStyle : stackBodyStyle}>
      {blocks.map((block) => (
        <BlockRenderer
          assets={assets}
          block={block}
          key={block.id}
          renderAsset={renderAsset}
          resolveAssetUrl={resolveAssetUrl}
        />
      ))}
    </div>
  );
}

function visibleBodyBlocks(slide: SlideNode) {
  const [firstBlock, ...remainingBlocks] = slide.blocks;
  if (firstBlock?.type === "heading" && firstBlock.text.trim() === slide.title.trim()) {
    return remainingBlocks;
  }

  return slide.blocks;
}

function getLayoutMode(layout: string): SlideLayoutMode {
  if (layout === "title_statement" || layout === "section_divider" || layout === "quiz_transition") {
    return "center";
  }

  if (layout === "table_focus" || layout === "chart_focus") {
    return "focus";
  }

  if (
    layout === "technical_two_column" ||
    layout === "technical_figure_left" ||
    layout === "technical_figure_right" ||
    layout === "definition_with_example" ||
    layout === "formula_derivation" ||
    layout === "comparison_split"
  ) {
    return "split";
  }

  return "stack";
}

function isVisualBlock(block: SlideBlock) {
  return block.type === "figure" || block.type === "formula" || block.type === "table" || block.type === "chart";
}

function sourceSummary(count: number) {
  if (count === 0) return "";
  if (count === 1) return "1 Quelle";
  return `${count} Quellen`;
}
