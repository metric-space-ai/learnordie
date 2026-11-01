import type { LectureMaterial } from "@/lib/types";
import type { PptxSlideStructure, StoredUploadArtifact } from "./upload-extraction";

export type PptxSlideRange = NonNullable<LectureMaterial["slideRange"]>;

export function parsePptxSlideRangeInput(value: unknown): PptxSlideRange | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("Folienbereich ist ungültig. Von und Bis müssen ganze Zahlen sein.");
  }

  const { from, to } = value as { from?: unknown; to?: unknown };
  if (
    typeof from !== "number" || !Number.isInteger(from) || from < 1
    || typeof to !== "number" || !Number.isInteger(to) || to < from
  ) {
    throw new Error("Folienbereich ist ungültig. Von muss mindestens 1 sein und Bis darf nicht kleiner sein.");
  }

  return { from, to };
}

export function filterPptxSlideStructuresByRange(
  structures: PptxSlideStructure[],
  range?: PptxSlideRange | null
): PptxSlideStructure[] {
  if (!range) return structures;

  const maxSlide = structures.reduce((maximum, structure) => Math.max(maximum, structure.slide), 0);
  if (range.from < 1 || range.to < range.from || range.to > maxSlide) {
    throw new Error(`Folienbereich ist ungültig. Die Quelle enthält ${maxSlide} Folien.`);
  }

  const filtered = structures.filter((structure) => structure.slide >= range.from && structure.slide <= range.to);
  if (filtered.length === 0) {
    throw new Error("Der gewählte Folienbereich enthält keine Folien.");
  }
  return filtered;
}

export function filterUploadArtifactsBySlideRange(
  artifacts: StoredUploadArtifact[],
  range?: PptxSlideRange | null
): StoredUploadArtifact[] {
  if (!range) return artifacts;
  return artifacts.filter((artifact) => (
    artifact.slide === undefined || (artifact.slide >= range.from && artifact.slide <= range.to)
  ));
}

export function pptxSlideStructuresToText(structures: PptxSlideStructure[]): string {
  return structures.map((structure) => {
    const parts = [
      `Folie ${structure.slide}: ${structure.title ?? ""}`.trim(),
      ...structure.textBoxes.map((textBox) => textBox.text),
      ...structure.tables.flatMap((table) => table.rows.map((row) => row.join(" | "))),
      ...structure.charts.flatMap((chart) => [chart.title, chart.text]),
      structure.notes
    ];
    return parts.filter((part): part is string => Boolean(part?.trim())).join("\n");
  }).filter(Boolean).join("\n\n");
}
