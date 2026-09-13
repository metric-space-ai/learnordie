import assert from "node:assert/strict";
import test from "node:test";
import { canvasReadingElements } from "@/lib/canvas-reading-layout";
import { createOriginalModelDocument } from "@/lib/model-original-template";
import { canvasSceneForSlide } from "@learnordie/slide-engine/excalidraw/scene";

test("all eight original slides reflow their actual editable elements without mutating the deck", () => {
  const document = createOriginalModelDocument("test", Array.from({ length: 8 }, (_, i) => `s${i}`));
  const before = JSON.stringify(document);
  for (const slide of document.slides) {
    const items = canvasReadingElements(slide.canvas!, slide.id);
    assert.ok(items);
    assert.equal(items.length, slide.canvas!.elements.length);
    assert.equal(items.filter(item => item.type === "embeddable").length, 1);
  }
  assert.equal(JSON.stringify(document), before);
});

test("a new drawing or a spatially bound text keeps the complete native canvas", () => {
  const slide = createOriginalModelDocument("test", Array.from({ length: 8 }, (_, i) => `s${i}`)).slides[0];
  const scene = slide.canvas!;
  assert.equal(canvasReadingElements({ ...scene, elements: [...scene.elements, { id: "new-drawing", type: "ellipse", x: 0, y: 0, width: 80, height: 80 }] }, slide.id), null);
  assert.equal(canvasReadingElements({ ...scene, elements: scene.elements.map((item, i) => i < 2 ? { ...item, groupIds: ["diagram"] } : item) }, slide.id), null);
});

test("current edits are used and deleted text is not resurrected from semantic blocks", () => {
  const slide = createOriginalModelDocument("test", Array.from({ length: 8 }, (_, i) => `s${i}`)).slides[0];
  const scene = slide.canvas!;
  scene.elements[0].originalText = "Aktuell bearbeiteter Titel";
  scene.elements[1].isDeleted = true;
  const result = canvasReadingElements(scene, slide.id)!;
  assert.ok(result.some(item => item.originalText === "Aktuell bearbeiteter Titel"));
  assert.ok(!result.some(item => item.id === scene.elements[1].id));
});

test("legacy generated prose callouts reflow, but an added rectangle is not discarded", () => {
  const scene = canvasSceneForSlide({ id: "legacy", title: "Begriff", layout: "technical_figure_right", intent: "explanation",
    blocks: [{ id: "callout", type: "callout", tone: "info", text: "Abbild → Beziehung → Funktion" }], speakerNotes: [], sourceRefs: [] });
  const result = canvasReadingElements(scene, "legacy");
  assert.ok(result?.some(item => item.text === "Abbild → Beziehung → Funktion"));
  assert.ok(result?.every(item => item.type === "text"));
  const rectangle = scene.elements.find(item => item.type === "rectangle")!;
  rectangle.id = "user-rectangle";
  assert.equal(canvasReadingElements(scene, "legacy"), null);
});
