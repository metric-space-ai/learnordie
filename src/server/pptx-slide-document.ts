import crypto from "node:crypto";
import path from "node:path";

import {
  SLIDE_DOCUMENT_SCHEMA_VERSION,
  validateSlideDocument,
  type SlideAssetRef,
  type SlideDocument,
  type SlideNode
} from "@learnordie/slide-engine";

import type { Lecture, LectureMaterial } from "@/lib/types";
import type {
  PptxChartStructure,
  PptxImageStructure,
  PptxSlideStructure,
  PptxTableStructure,
  PptxTextBoxStructure,
  StoredUploadArtifact
} from "@/server/upload-extraction";
import type { ProcessedMaterial } from "./material-pipeline";
import { filterPptxSlideStructuresByRange, filterUploadArtifactsBySlideRange } from "./pptx-slide-range";

const MAX_SLIDE_TEXT_BOXES = 5;
const MAX_SLIDE_IMAGES = 3;
const MAX_TEXT_BLOCK_CHARS = 900;

type PptxImportInput = {
  lecture: Pick<Lecture, "id" | "title" | "seriesTitle" | "language">;
  material: Pick<LectureMaterial, "id" | "kind" | "originalName" | "slideRange">;
  processed: Pick<ProcessedMaterial, "artifacts" | "slideStructures">;
};

export function createPptxImportSlideDocument(input: PptxImportInput): SlideDocument | null {
  if (input.material.kind !== "pptx" || input.processed.slideStructures.length === 0) return null;

  const sourceBaseId = stableId(`pptx-${input.material.id}`);
  const slideStructures = filterPptxSlideStructuresByRange(input.processed.slideStructures, input.material.slideRange);
  const artifacts = filterUploadArtifactsBySlideRange(input.processed.artifacts, input.material.slideRange);
  const assets = createPptxImportAssets(artifacts, input.material, sourceBaseId);
  const document: SlideDocument = {
    schemaVersion: SLIDE_DOCUMENT_SCHEMA_VERSION,
    id: stableId(`deck-${input.lecture.id}-${input.material.id}`, "pptx-import-deck"),
    title: `${input.lecture.seriesTitle}: ${input.lecture.title}`,
    language: input.lecture.language || "de",
    aspect: "16:9",
    theme: "learnordie-technical",
    deckSettings: {
      defaultTransition: "slide",
      showSlideNumbers: true,
      allowFragments: false,
      mobileMode: "hybrid"
    },
    slides: slideStructures
      .sort((left, right) => left.slide - right.slide)
      .map((structure, index) => pptxStructureToSlideNode({
        structure,
        index,
        material: input.material,
        sourceBaseId,
        assets
      })),
    assets,
    createdBy: {
      mode: "import",
      promptVersion: "pptx-html-replica-v1"
    }
  };

  const validation = validateSlideDocument(document);
  if (!validation.ok) {
    throw new Error(`PPTX-Import erzeugte ein ungültiges SlideDocument: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }

  return validation.document;
}

function pptxStructureToSlideNode(input: {
  structure: PptxSlideStructure;
  index: number;
  material: Pick<LectureMaterial, "id" | "originalName">;
  sourceBaseId: string;
  assets: SlideAssetRef[];
}): SlideNode {
  const { structure, index, material, sourceBaseId, assets } = input;
  const slideId = crypto.randomUUID();
  const title = requiredText(structure.title || `Folie ${structure.slide}`, 140, `Folie ${structure.slide}`);
  const blocks: SlideNode["blocks"] = [
    {
      id: `${slideId}-heading`,
      type: "heading",
      text: title,
      level: 1
    }
  ];

  for (const block of textBoxesToBlocks(slideId, structure.textBoxes, title).slice(0, MAX_SLIDE_TEXT_BOXES)) {
    blocks.push(block);
  }

  for (const [tableIndex, table] of structure.tables.slice(0, 2).entries()) {
    const block = tableToBlock(slideId, table, tableIndex);
    if (block) blocks.push(block);
  }

  for (const [chartIndex, chart] of structure.charts.slice(0, 2).entries()) {
    blocks.push(chartToBlock(slideId, chart, chartIndex));
  }

  for (const [imageIndex, image] of structure.images.slice(0, MAX_SLIDE_IMAGES).entries()) {
    const block = imageToFigureBlock(slideId, image, imageIndex, assets);
    if (block) blocks.push(block);
  }

  if (blocks.length === 1) {
    blocks.push({
      id: `${slideId}-empty-note`,
      type: "paragraph",
      text: "Diese Folie enthält vor allem visuelle Inhalte. Bitte nach dem Import prüfen."
    });
  }

  return {
    id: slideId,
    title,
    layout: layoutFromStructure(structure),
    intent: index === 0 ? "title" : "concept",
    blocks: blocks.slice(0, 14),
    ...(structure.notes ? {
      speakerNotes: [{
        id: `${slideId}-speaker-notes`,
        kind: "source",
        text: requiredText(structure.notes, 1600, "Importierte Sprechernotiz.")
      }]
    } : {}),
    sourceRefs: [{
      id: `${slideId}-source`,
      sourceType: "import",
      label: boundedText(material.originalName, 220) ?? "PPTX Import",
      ...(stableIdPattern.test(material.id) ? { materialId: material.id } : {}),
      locator: `Folie ${structure.slide}`,
      slide: structure.slide
    }, {
      id: `${slideId}-pptx-import-source`,
      sourceType: "import",
      label: boundedText(`PPTX HTML-Replik ${sourceBaseId}`, 220) ?? "PPTX HTML-Replik",
      locator: `Importposition ${index + 1}`
    }]
  };
}

function createPptxImportAssets(
  artifacts: StoredUploadArtifact[],
  material: Pick<LectureMaterial, "id" | "originalName">,
  sourceBaseId: string
): SlideAssetRef[] {
  return artifacts
    .filter((artifact) => artifact.sourceKind === "pptx")
    .map((artifact, index) => {
      const assetId = pptxArtifactAssetId(artifact, index);
      return {
        id: assetId,
        kind: "diagram",
        title: requiredText(artifact.description || artifact.name, 160, "PPTX-Bild"),
        description: boundedText(artifact.visualLine || artifact.description, 500),
        storageKey: artifact.storageUrl,
        previewKey: artifact.previewUrl || artifact.storageUrl,
        altText: requiredText(artifact.description || artifact.name, 320, "PPTX-Bild"),
        extractedText: boundedText([artifact.description, artifact.visualLine].filter(Boolean).join("\n"), 10000),
        structuredData: {
          importKind: "pptxExtractedImage",
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          slide: artifact.slide,
          placement: artifact.placement
        },
        source: {
          id: stableId(`${sourceBaseId}-asset-${index + 1}`),
          sourceType: "import",
          label: boundedText(material.originalName, 220) ?? "PPTX Import",
          ...(stableIdPattern.test(material.id) ? { materialId: material.id } : {}),
          assetId,
          locator: artifact.slide ? `Folie ${artifact.slide} · ${artifact.name}` : artifact.name,
          ...(artifact.slide ? { slide: artifact.slide } : {}),
          ...(artifact.placement ? { bbox: artifact.placement } : {})
        },
        tags: ["pptx", "import", "extracted-image"],
        quality: {
          extractionConfidence: artifact.description ? 0.72 : 0.58,
          needsReview: true,
          reason: "Aus PPTX extrahiertes Bild, in der HTML-Replik übernommen."
        }
      };
    });
}

function textBoxesToBlocks(slideId: string, textBoxes: PptxTextBoxStructure[], title: string): SlideNode["blocks"] {
  const blocks: SlideNode["blocks"] = [];
  const seen = new Set([normalizeTextKey(title)]);

  for (const [index, box] of textBoxes.entries()) {
    if (box.role === "title") continue;
    const text = compactText(box.text);
    const key = normalizeTextKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);

    if (isFormulaLike(text)) {
      blocks.push({
        id: `${slideId}-formula-${index + 1}`,
        type: "formula",
        latex: requiredText(text, 2000, "Formel"),
        caption: box.name ? boundedText(box.name, 240) : undefined
      });
      continue;
    }

    const lines = box.text.split(/\n+/).map(compactText).filter(Boolean);
    if (lines.length >= 2 && lines.length <= 8 && lines.every((line) => line.length <= 220)) {
      blocks.push({
        id: `${slideId}-list-${index + 1}`,
        type: "bulletList",
        items: lines.map((line, lineIndex) => requiredText(line, 220, `Punkt ${lineIndex + 1}`)).slice(0, 8)
      });
      continue;
    }

    for (const [paragraphIndex, paragraph] of splitLongText(text, MAX_TEXT_BLOCK_CHARS).entries()) {
      blocks.push({
        id: `${slideId}-paragraph-${index + 1}-${paragraphIndex + 1}`,
        type: "paragraph",
        text: paragraph
      });
    }
  }

  return blocks;
}

function tableToBlock(slideId: string, table: PptxTableStructure, tableIndex: number): SlideNode["blocks"][number] | null {
  const rows = table.rows
    .map((row) => row.map((cell) => boundedText(compactText(cell), 400) ?? "").slice(0, 8))
    .filter((row) => row.some(Boolean))
    .slice(0, 40);
  if (rows.length === 0) return null;

  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const firstRow = normalizeRow(rows[0], columnCount);
  const hasHeader = rows.length > 1 && firstRow.some(Boolean);
  const columns = hasHeader
    ? firstRow.map((cell, index) => (cell ? boundedText(cell, 120) ?? `Spalte ${index + 1}` : `Spalte ${index + 1}`))
    : Array.from({ length: columnCount }, (_item, index) => `Spalte ${index + 1}`);
  const dataRows = (hasHeader ? rows.slice(1) : rows).map((row) => normalizeRow(row, columnCount));

  return {
    id: `${slideId}-table-${tableIndex + 1}`,
    type: "table",
    caption: `Tabelle ${tableIndex + 1}`,
    columns,
    rows: dataRows.length > 0 ? dataRows : [firstRow],
    mobileStrategy: "scroll"
  };
}

function chartToBlock(slideId: string, chart: PptxChartStructure, chartIndex: number): SlideNode["blocks"][number] {
  const labels = (chart.labels?.length ? chart.labels : ["A", "B", "C"])
    .slice(0, 8)
    .map((label, labelIndex) => requiredText(compactText(label), 80, `Wert ${labelIndex + 1}`));
  const values = (chart.values?.length ? chart.values : labels.map((_label, index) => 1 - index * 0.2)).slice(0, labels.length);
  return {
    id: `${slideId}-chart-${chartIndex + 1}`,
    type: "chart",
    chartType: "bar",
    title: boundedText(chart.title || `Diagramm ${chartIndex + 1}`, 160),
    data: { labels, values },
    caption: chart.sourceRef ? boundedText(path.posix.basename(chart.sourceRef), 240) : undefined
  };
}

function imageToFigureBlock(
  slideId: string,
  image: PptxImageStructure,
  imageIndex: number,
  assets: SlideAssetRef[]
): SlideNode["blocks"][number] | null {
  const asset = findAssetForImage(image, assets);
  if (!asset) return null;

  return {
    id: `${slideId}-figure-${imageIndex + 1}`,
    type: "figure",
    assetId: asset.id,
    altText: requiredText(image.description || asset.altText || asset.title, 320, "PPTX-Bild"),
    caption: boundedText(cleanImageCaption(image.description || image.name), 240),
    fit: "contain"
  };
}

function findAssetForImage(image: PptxImageStructure, assets: SlideAssetRef[]) {
  const wantedName = path.posix.basename(image.target || image.name).toLowerCase();
  const wantedSlide = image.placement ? undefined : undefined;
  void wantedSlide;

  return assets.find((asset) => {
    const assetData = asset.structuredData as { slide?: number } | undefined;
    if (image.placement && asset.source?.bbox) {
      return placementsOverlap(image.placement, asset.source.bbox);
    }
    const locator = asset.source?.locator?.toLowerCase() ?? "";
    return wantedName && locator.includes(wantedName) && (!image.description || asset.source?.slide === undefined || asset.source.slide === assetData?.slide);
  }) ?? assets.find((asset) => (
    typeof asset.source?.slide === "number" && image.placement && asset.source.bbox && placementsOverlap(image.placement, asset.source.bbox)
  )) ?? null;
}

function layoutFromStructure(structure: PptxSlideStructure): SlideNode["layout"] {
  if (structure.tables.length > 0) return "table_focus";
  if (structure.charts.length > 0) return "chart_focus";
  if (structure.images.length > 0) {
    const firstHint = structure.layoutHints.find((hint) => hint === "technical_figure_left" || hint === "technical_figure_right");
    return firstHint === "technical_figure_left" ? "technical_figure_left" : "technical_figure_right";
  }
  if (structure.textBoxes.length > 2) return "technical_two_column";
  return "technical_one_column";
}

function pptxArtifactAssetId(artifact: StoredUploadArtifact, index: number) {
  return stableId(`pptx-image-${artifact.slide ?? "x"}-${artifact.name}-${index + 1}`);
}

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function stableId(value: string, fallback = "pptx-import") {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 110);
  return stableIdPattern.test(sanitized) ? sanitized : fallback;
}

function compactText(value: string) {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeTextKey(value: string) {
  return compactText(value).toLocaleLowerCase("de-DE");
}

function boundedText(value: string | undefined, max: number) {
  const text = compactText(value ?? "");
  if (!text) return max <= 160 ? "Import" : undefined;
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function requiredText(value: string | undefined, max: number, fallback: string) {
  return boundedText(value, max) ?? fallback;
}

function splitLongText(value: string, maxChars: number) {
  const text = boundedText(value, 1200);
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars && parts.length < 3) {
    const cut = Math.max(
      remaining.lastIndexOf(". ", maxChars),
      remaining.lastIndexOf("; ", maxChars),
      remaining.lastIndexOf("\n", maxChars)
    );
    const index = cut > 220 ? cut + 1 : maxChars;
    parts.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.map((part) => boundedText(part, maxChars)).filter(Boolean) as string[];
}

function isFormulaLike(value: string) {
  return value.length < 260 && (
    /(?:η|μ|omega|ω|lambda|λ|S\s*=|p\s*=|F\s*=|\\frac)/i.test(value) ||
    /[A-Za-z]\s*=\s*[^=]+/.test(value)
  );
}

function normalizeRow(row: string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_item, index) => boundedText(row[index] ?? "", 400) ?? "");
}

function cleanImageCaption(value: string) {
  return compactText(value.replace(/^Bild(?:basierte PPTX-Inhalte erkannt)?:?\s*/i, ""));
}

function placementsOverlap(left: NonNullable<PptxImageStructure["placement"]>, right: NonNullable<SlideAssetRef["source"]>["bbox"]) {
  if (!right) return false;
  const dx = Math.abs((left.x + left.width / 2) - (right.x + right.width / 2));
  const dy = Math.abs((left.y + left.height / 2) - (right.y + right.height / 2));
  return dx <= Math.max(left.width, right.width) / 2 && dy <= Math.max(left.height, right.height) / 2;
}
