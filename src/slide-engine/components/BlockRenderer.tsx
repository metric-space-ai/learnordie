/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";

import type {
  BulletListBlock,
  CalloutBlock,
  FigureBlock,
  FormulaBlock,
  HeadingBlock,
  ParagraphBlock,
  SlideAsset,
  SlideAssetCollection,
  SlideAssetUrlResolver,
  SlideBlock,
  SupportedSlideBlock,
  TableBlock,
  TableCellValue
} from "./types";

export type BlockRendererProps = {
  block: SlideBlock;
  assets?: SlideAssetCollection;
  resolveAssetUrl?: SlideAssetUrlResolver;
};

const blockSpacingStyle: CSSProperties = {
  minWidth: 0
};

const headingStyle: CSSProperties = {
  margin: 0,
  color: "var(--ink)",
  fontSize: "clamp(30px, 4.2vw, 58px)",
  fontWeight: 860,
  letterSpacing: 0,
  lineHeight: 1.04
};

const paragraphStyle: CSSProperties = {
  margin: 0,
  color: "var(--ink)",
  fontSize: "clamp(18px, 2.2vw, 28px)",
  lineHeight: 1.38
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  margin: 0,
  paddingInlineStart: 24,
  color: "var(--ink)",
  fontSize: "clamp(18px, 2.1vw, 27px)",
  lineHeight: 1.34
};

const figureStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  margin: 0,
  minWidth: 0
};

const imageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxHeight: "min(62vh, 520px)",
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-panel)",
  background: "var(--panel-soft)",
  objectFit: "contain"
};

const figurePlaceholderStyle: CSSProperties = {
  display: "grid",
  minHeight: 220,
  placeItems: "center",
  padding: 24,
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-panel)",
  background:
    "linear-gradient(135deg, oklch(98% 0.006 230), oklch(91% 0.02 230))",
  color: "var(--muted)",
  fontSize: 15,
  fontWeight: 760,
  textAlign: "center"
};

const captionStyle: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: 13,
  fontWeight: 650,
  lineHeight: 1.35
};

const formulaStyle: CSSProperties = {
  overflowX: "auto",
  margin: 0,
  padding: "18px 20px",
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-panel)",
  background: "oklch(97% 0.011 230)",
  color: "var(--ink)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  fontSize: "clamp(18px, 2.2vw, 30px)",
  lineHeight: 1.35,
  whiteSpace: "pre"
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-panel)",
  background: "var(--panel)"
};

const tableStyle: CSSProperties = {
  width: "100%",
  minWidth: 520,
  borderCollapse: "collapse",
  color: "var(--ink)",
  fontSize: "clamp(14px, 1.4vw, 18px)",
  lineHeight: 1.35
};

const tableHeaderStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--line)",
  background: "oklch(94% 0.014 230)",
  fontWeight: 820,
  textAlign: "left"
};

const tableCellStyle: CSSProperties = {
  padding: "11px 14px",
  borderBottom: "1px solid oklch(86% 0.018 230)",
  verticalAlign: "top"
};

const calloutBaseStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  padding: "16px 18px",
  border: "1px solid var(--line)",
  borderLeftWidth: 5,
  borderRadius: "var(--lb-radius-panel)",
  background: "var(--panel)",
  color: "var(--ink)"
};

const calloutTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(16px, 1.6vw, 21px)",
  fontWeight: 820,
  lineHeight: 1.2
};

const calloutTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(15px, 1.55vw, 20px)",
  lineHeight: 1.38
};

const calloutToneStyles: Record<NonNullable<CalloutBlock["tone"]>, CSSProperties> = {
  info: {
    borderColor: "var(--lb-kinematic)",
    background: "var(--lb-kinematic-soft)"
  },
  key: {
    borderColor: "var(--accent)",
    background: "var(--accent-soft)"
  },
  tip: {
    borderColor: "var(--green)",
    background: "var(--green-soft)"
  },
  warning: {
    borderColor: "var(--red)",
    background: "var(--red-soft)"
  }
};

const unsupportedBlockStyle: CSSProperties = {
  padding: "14px 16px",
  border: "1px dashed var(--line)",
  borderRadius: "var(--lb-radius-panel)",
  background: "oklch(97% 0.006 230)",
  color: "var(--muted)",
  fontSize: 14,
  fontWeight: 720
};

export function BlockRenderer({ block, assets, resolveAssetUrl }: BlockRendererProps) {
  switch (block.type) {
    case "heading":
      return <HeadingBlockRenderer block={block} />;
    case "paragraph":
      return <ParagraphBlockRenderer block={block} />;
    case "bulletList":
      return <BulletListBlockRenderer block={block} />;
    case "figure":
      return <FigureBlockRenderer assets={assets} block={block} resolveAssetUrl={resolveAssetUrl} />;
    case "formula":
      return <FormulaBlockRenderer block={block} />;
    case "table":
      return <TableBlockRenderer block={block} />;
    case "callout":
      return <CalloutBlockRenderer block={block} />;
    default:
      return <UnsupportedBlockRenderer block={block} />;
  }
}

function HeadingBlockRenderer({ block }: { block: HeadingBlock }) {
  const Tag = block.level === 3 ? "h3" : block.level === 2 ? "h2" : "h1";

  return (
    <div data-block-id={block.id} data-block-type={block.type} style={blockSpacingStyle}>
      <Tag style={headingStyle}>{block.text}</Tag>
    </div>
  );
}

function ParagraphBlockRenderer({ block }: { block: ParagraphBlock }) {
  return (
    <p
      data-block-id={block.id}
      data-block-type={block.type}
      style={paragraphStyle}
    >
      {block.text}
    </p>
  );
}

function BulletListBlockRenderer({ block }: { block: BulletListBlock }) {
  return (
    <ul
      data-block-id={block.id}
      data-block-type={block.type}
      style={listStyle}
    >
      {block.items.map((item, index) => (
        <BulletListEntry item={item} key={index} />
      ))}
    </ul>
  );
}

function BulletListEntry({ item }: { item: string }) {
  return <li>{item}</li>;
}

function FigureBlockRenderer({
  assets,
  block,
  resolveAssetUrl
}: {
  assets?: SlideAssetCollection;
  block: FigureBlock;
  resolveAssetUrl?: SlideAssetUrlResolver;
}) {
  const asset = resolveAsset(assets, block.assetId);
  const imageUrl = asset ? resolveAssetUrl?.(asset, block) ?? asset.url : undefined;
  const altText = block.altText ?? asset?.altText ?? asset?.description ?? asset?.title ?? block.caption ?? "";
  const label = block.caption ?? asset?.title ?? block.assetId ?? "Figure";

  return (
    <figure
      data-asset-id={block.assetId}
      data-block-id={block.id}
      data-block-type={block.type}
      style={figureStyle}
    >
      {imageUrl ? (
        <img
          alt={altText}
          loading="lazy"
          src={imageUrl}
          style={{
            ...imageStyle,
            objectFit: block.fit ?? "contain"
          }}
        />
      ) : (
        <div aria-label={label} role="img" style={figurePlaceholderStyle}>
          {label}
        </div>
      )}
      {block.caption ? <figcaption style={captionStyle}>{block.caption}</figcaption> : null}
    </figure>
  );
}

function FormulaBlockRenderer({ block }: { block: FormulaBlock }) {
  const formula = block.latex ?? block.mathMl ?? "";

  return (
    <figure
      data-block-id={block.id}
      data-block-type={block.type}
      style={figureStyle}
    >
      <pre aria-label={formula} role="math" style={formulaStyle}>
        <code>{formula}</code>
      </pre>
      {block.caption ? <figcaption style={captionStyle}>{block.caption}</figcaption> : null}
    </figure>
  );
}

function TableBlockRenderer({ block }: { block: TableBlock }) {
  return (
    <figure
      data-block-id={block.id}
      data-block-type={block.type}
      style={figureStyle}
    >
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          {block.caption ? <caption style={captionStyle}>{block.caption}</caption> : null}
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th
                  key={columnKey(column, index)}
                  scope="col"
                  style={tableHeaderStyle}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.columns.map((column, columnIndex) => (
                  <td
                    key={columnKey(column, columnIndex)}
                    style={tableCellStyle}
                  >
                    {cellValue(row, column, columnIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function CalloutBlockRenderer({ block }: { block: CalloutBlock }) {
  const tone = block.tone ?? "info";

  return (
    <aside
      data-block-id={block.id}
      data-block-type={block.type}
      style={{ ...calloutBaseStyle, ...calloutToneStyles[tone] }}
    >
      {block.title ? <strong style={calloutTitleStyle}>{block.title}</strong> : null}
      <p style={calloutTextStyle}>{block.text}</p>
    </aside>
  );
}

function resolveAsset(
  assets: SlideAssetCollection | undefined,
  assetId: string | undefined
): SlideAsset | undefined {
  if (!assets || !assetId) return undefined;
  if (Array.isArray(assets)) return assets.find((asset) => asset.id === assetId);
  return assets[assetId];
}

function columnKey(column: string, index: number) {
  return `${column}-${index}`;
}

function cellValue(row: string[], _column: string, columnIndex: number) {
  const value = row[columnIndex];
  return formatTableCell(value);
}

function formatTableCell(value: TableCellValue | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function UnsupportedBlockRenderer({ block }: { block: Exclude<SlideBlock, SupportedSlideBlock> }) {
  return (
    <div data-block-id={block.id} data-block-type={block.type} style={unsupportedBlockStyle}>
      Unsupported slide block: {block.type}
    </div>
  );
}
