import assert from "node:assert/strict";
import test from "node:test";

import { createPptxImportSlideDocument } from "./pptx-slide-document";
import {
  filterPptxSlideStructuresByRange,
  filterUploadArtifactsBySlideRange,
  parsePptxSlideRangeInput,
  pptxSlideStructuresToText
} from "./pptx-slide-range";
import type { PptxSlideStructure, StoredUploadArtifact } from "./upload-extraction";

function structure(slide: number): PptxSlideStructure {
  return {
    slide,
    title: `Folie ${slide}`,
    textBoxes: [{ text: `Inhalt ${slide}`, role: "body" }],
    tables: [],
    charts: [],
    images: [],
    layoutHints: []
  };
}

const structures = Array.from({ length: 70 }, (_item, index) => structure(index + 1));
const material = {
  id: "material_00000000-0000-4000-8000-000000000000",
  kind: "pptx" as const,
  originalName: "Vorlesung.pptx"
};
const lecture = {
  id: "lecture_00000000-0000-4000-8000-000000000000",
  title: "Test",
  seriesTitle: "Testreihe",
  language: "de"
};

test("Bereichseingabe akzeptiert Zahlen, Löschen und unveränderte Anfragen", () => {
  assert.deepEqual(parsePptxSlideRangeInput({ from: 40, to: 67 }), { from: 40, to: 67 });
  assert.equal(parsePptxSlideRangeInput(null), null);
  assert.equal(parsePptxSlideRangeInput(undefined), undefined);
  assert.throws(() => parsePptxSlideRangeInput({ from: 0, to: 4 }), /Folienbereich ist ungültig/);
  assert.throws(() => parsePptxSlideRangeInput({ from: 8, to: 4 }), /Folienbereich ist ungültig/);
  assert.throws(() => parsePptxSlideRangeInput({ from: 1.5, to: 4 }), /Folienbereich ist ungültig/);
});

test("Folien und bildbezogene Artefakte werden auf das Kapitel begrenzt", () => {
  const selected = filterPptxSlideStructuresByRange(structures, { from: 40, to: 67 });
  assert.equal(selected.length, 28);
  assert.equal(selected[0].slide, 40);
  assert.equal(selected.at(-1)?.slide, 67);
  assert.throws(() => filterPptxSlideStructuresByRange(structures, { from: 40, to: 71 }), /70 Folien/);

  const artifacts = [
    { name: "a", slide: 39 },
    { name: "b", slide: 40 },
    { name: "c", slide: 67 },
    { name: "d", slide: 68 },
    { name: "ohne-folie" }
  ] as StoredUploadArtifact[];
  assert.deepEqual(filterUploadArtifactsBySlideRange(artifacts, { from: 40, to: 67 }).map((item) => item.name), ["b", "c", "ohne-folie"]);
});

test("Kapiteltext enthält nur die ausgewählten Originalfolien", () => {
  const text = pptxSlideStructuresToText(filterPptxSlideStructuresByRange(structures, { from: 40, to: 67 }));
  assert.match(text, /Folie 40: Folie 40/);
  assert.match(text, /Inhalt 67/);
  assert.doesNotMatch(text, /Inhalt 39\n/);
  assert.doesNotMatch(text, /Inhalt 68\n/);
});

test("PPTX-Import erzeugt genau das 45-Minuten-Kapitel 40–67", () => {
  const deck = createPptxImportSlideDocument({
    lecture,
    material: { ...material, slideRange: { from: 40, to: 67 } },
    processed: { artifacts: [], slideStructures: structures }
  });
  assert.ok(deck);
  assert.equal(deck.slides.length, 28);
  assert.equal(deck.slides[0].title, "Folie 40");
  assert.equal(deck.slides.at(-1)?.title, "Folie 67");
  assert.equal(deck.slides[0].sourceRefs[0].slide, 40);
  assert.equal(deck.slides.at(-1)?.sourceRefs[0].slide, 67);
});

test("Ohne Bereich bleibt der vollständige PPTX-Import erhalten", () => {
  const deck = createPptxImportSlideDocument({
    lecture,
    material,
    processed: { artifacts: [], slideStructures: structures }
  });
  assert.ok(deck);
  assert.equal(deck.slides.length, 70);
});
