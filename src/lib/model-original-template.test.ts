import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseSlideDocument, validateSlideDocument } from "@learnordie/slide-engine/schema";
import { canvasSceneForSlide, updateSlideCanvas } from "@learnordie/slide-engine/excalidraw/scene";
import { canvasSceneSchema } from "@learnordie/slide-engine/excalidraw/canvas-schema";
import { originalModelSlides, originalModelCompanion, originalModelSourcesHtml, originalModelProvenance } from "./model-original-source";
import { applyOriginalModelUpgrade, createOriginalModelDocument, MODEL_ORIGINAL_KEY, MODEL_ORIGINAL_SCENE_LABELS, MODEL_ORIGINAL_TITLE, originalModelText, planOriginalModelUpgrade } from "./model-original-template";
import { createModelDemoDocument } from "./model-demo-template";
import { handleModelOriginalSource } from "@/server/model-original-source-handler";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const doc = () => createOriginalModelDocument("original", originalModelSlides.map((_, i) => `original-slide-${i}`));

test("source download and readable original notes require a mocked valid session, without filesystem or DB access", async () => {
  for (const view of ["", "?view=read"]) {
    const request = new Request(`https://example.test/api/lectures/model-demo/source${view}`);
    assert.equal((await handleModelOriginalSource(request, async () => null)).status, 401);
    const response = await handleModelOriginalSource(request, async () => ({ email: "reader@example.test" }));
    assert.equal(response.status, view ? 303 : 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.text();
    if (!view) assert.equal(body, originalModelCompanion);
    else {
      assert.equal(response.headers.get("location"), "/lecturer/model-original");
      assert.equal(body, "");
    }
  }
});

test("original snapshots and entire companion are independently hash-pinned", () => {
  const root = "docs/sources/model-original/";
  assert.equal(sha(readFileSync(root + "authored-slides.txt", "utf8").trimEnd()), originalModelProvenance.html.authoredDataSha256);
  assert.equal(sha(readFileSync(root + "source-dialog.html", "utf8").trimEnd()), originalModelProvenance.html.sourceDialogSha256);
  assert.equal(sha(originalModelSourcesHtml), originalModelProvenance.html.sourceDialogSha256);
  assert.equal(sha(originalModelCompanion), "d4f448eb8a449475cbc861dbf8eb483d5b51e2f8af22413f5801c27083664da0");
  assert.equal(readFileSync(root + originalModelProvenance.companion.file, "utf8"), originalModelCompanion);
  assert.equal(originalModelCompanion.trimEnd().split("\n").length, 1350);
  assert.equal(originalModelProvenance.sections.length, 16);
  for (const [i, section] of originalModelProvenance.sections.entries()) {
    const lines = originalModelCompanion.split("\n"), end = originalModelProvenance.sections[i + 1]?.startLine;
    const text = lines.slice(section.startLine - 1, end ? end - 1 : undefined).join("\n") + (end ? "\n" : "");
    assert.equal(sha(text), section.sha256, section.title);
  }
});

test("eight exact authored slides retain all visible fields, notes, source links and native scene mappings", () => {
  const document = doc();
  assert.equal(validateSlideDocument(document).ok, true);
  assert.equal(document.createdBy.mode, "import");
  assert.equal(document.createdBy.promptVersion, MODEL_ORIGINAL_KEY);
  assert.deepEqual(document.slides.map((s) => s.title), ["Ein Begriff.\nIm Wandel.", "Die Welt\nim Kleinen.", "Nicht das Ding.\nDie Beziehung.", "Ein Geschehen.\nViele Modelle.", "Vom Abbild\nzur Wirkung.", "Die Funktion\nentsteht.", "Das Modell\nspricht.", "Wir gestalten\ndas Lernen."]);
  for (const [index, slide] of document.slides.entries()) {
    const source = originalModelSlides[index];
    assert.equal(Object.keys(source).length, 13);
    const canvas = canvasSceneForSlide(slide, document.assets);
    assert.equal(canvasSceneSchema.safeParse(canvas).success, true);
    assert.equal(canvas.elements.some((e) => e.type === "image"), false);
    const texts = canvas.elements.filter((e) => e.type === "text").map((e) => e.originalText);
    for (const field of ["title", "kicker", "lead", "formula", "takeaway", "question", "sceneTitle", "sceneSub", "source"] as const) {
      assert.ok(texts.includes(originalModelText(source[field])), `${source.scene}.${field}`);
    }
    for (const block of slide.blocks.filter((b) => b.type === "paragraph")) assert.ok(texts.includes(block.text));
    if (MODEL_ORIGINAL_SCENE_LABELS[source.scene]) assert.ok(texts.includes(MODEL_ORIGINAL_SCENE_LABELS[source.scene]));
    assert.equal(slide.speakerNotes!.slice(0, -1).map((n) => n.text).join("\n\n"), originalModelText(source.notes));
    assert.equal(slide.sourceRefs[0].slide, index + 1);
    const embeds = canvas.elements.filter((e) => e.type === "embeddable");
    assert.equal(embeds.length, 1);
    assert.deepEqual(embeds[0].customData?.learnordie, { type: "scene3d", sceneId: `modell.${source.scene}`, caption: source.sceneSub, accent: source.accent });
    for (const element of canvas.elements) {
      assert.equal(element.locked, false);
      assert.ok(element.x >= 0 && element.y >= 0 && element.x + element.width <= 1600 && element.y + element.height <= 900, `${source.scene}:${element.id} within frame`);
    }
    for (let i = 0; i < canvas.elements.length; i++) for (let j = i + 1; j < canvas.elements.length; j++) {
      const a = canvas.elements[i], b = canvas.elements[j];
      assert.equal(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, false, `${source.scene}: ${a.id} overlaps ${b.id}`);
    }
  }
  assert.equal((document.assets[1].structuredData as { text: string }).text, originalModelCompanion);
  assert.deepEqual((document.assets[0].structuredData as { slides: unknown }).slides, originalModelSlides);
  assert.doesNotMatch(JSON.stringify(document), /\/Users\/|\/Volumes\/|qa-live@|Beispielsatz/);
});

test("native edits survive JSON round-trip without altering authored assets and notes", () => {
  const document = doc(), slide = document.slides[0], canvas = structuredClone(slide.canvas!);
  const lead = canvas.elements.find((e) => e.customData?.sourceBlockId === "original-morph-lead")!;
  lead.text = lead.originalText = "Eigene Bearbeitung";
  lead.x += 10;
  const persisted = JSON.parse(JSON.stringify(updateSlideCanvas(document, slide.id, canvas)));
  assert.equal(validateSlideDocument(persisted).ok, true);
  assert.equal(persisted.slides[0].blocks.find((b: { id: string }) => b.id === "original-morph-lead").text, "Eigene Bearbeitung");
  assert.deepEqual(persisted.assets, document.assets);
  assert.deepEqual(persisted.slides[0].speakerNotes, slide.speakerNotes);
  assert.throws(() => createOriginalModelDocument("bad", ["one"]));
  assert.throws(() => createOriginalModelDocument("bad", Array(8).fill("same")));
});

test("the planner upgrades the abbreviated generated deck without losing slide identity, grades or assets", () => {
  const ids = originalModelSlides.map((_, index) => `legacy-slide-${index}`);
  const abbreviated = createModelDemoDocument("legacy", ids);
  abbreviated.slides[0].quizAnchors = [{ id: "legacy-grade", level: "2.0", blockId: "morph-task", label: "Prüffrage" }];
  abbreviated.assets.push({ id: "student-attachment", kind: "sourceDocument", title: "Eigene Anlage", extractedText: "Zusatzmaterial" });
  const before = JSON.stringify(abbreviated);
  const plan = planOriginalModelUpgrade(abbreviated);
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.conflicts, []);
  const upgraded = applyOriginalModelUpgrade(plan);
  assert.deepEqual(upgraded.slides.map((slide) => slide.id), ids);
  assert.deepEqual(upgraded.slides[0].quizAnchors, abbreviated.slides[0].quizAnchors);
  assert.ok(upgraded.assets.some((asset) => asset.id === "student-attachment"));
  assert.ok(upgraded.assets.some((asset) => asset.id === "model-original-html"));
  assert.equal(upgraded.slides[0].blocks.find((block) => block.id === "morph-task")?.type, "paragraph");
  assert.equal(JSON.stringify(abbreviated), before, "planning must not mutate the source document");
  assert.equal(plan.coverage.length, 8 * 13);
  assert.ok(plan.coverage.every((evidence) => evidence.target.length > 0));
});

test("a source-import shaped deck gets missing authored fields while retaining existing source blocks", () => {
  const source = doc();
  const reduced = parseSlideDocument({
    ...source,
    id: "imported-lecture",
    title: "Der Modellbegriff im Wandel",
    createdBy: { mode: "import", promptVersion: "modellbegriff-threejs-html-import-v1" },
    assets: [source.assets[1]],
    slides: source.slides.map((slide) => ({
      ...slide,
      canvas: undefined,
      blocks: slide.blocks
        .filter((block) => ["kicker", "lead", "formula", "scene"].some((field) => block.id.endsWith(`-${field}`)))
        .map((block) => block.id.endsWith("-kicker") ? { ...block, type: "heading" as const } : block.id.endsWith("-formula") ? { ...block, type: "callout" as const, tone: "key" as const } : block.id.endsWith("-scene") && block.type === "scene3d" ? { ...block, altText: `${block.altText}. ${block.caption}`, caption: undefined } : block)
    }))
  });
  const plan = planOriginalModelUpgrade(reduced);
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.conflicts, []);
  const upgraded = applyOriginalModelUpgrade(plan);
  assert.equal(upgraded.id, reduced.id);
  assert.equal(upgraded.title, MODEL_ORIGINAL_TITLE);
  assert.ok(upgraded.slides.every((slide) => slide.canvas));
  assert.ok(upgraded.slides[0].blocks.some((block) => block.id === "original-morph-lead"));
  assert.equal(upgraded.assets.some((asset) => asset.id === "model-original-companion"), true);
  assert.equal(upgraded.assets.some((asset) => asset.id === "model-original-html"), true);
  assert.ok(plan.coverage.filter((evidence) => evidence.field === "nav").every((evidence) => evidence.status === "added"));
  assert.ok(plan.coverage.some((evidence) => evidence.field === "sceneTitle" && evidence.target.includes("sceneTitle")));
});

test("invalid cardinality, capacity and semantic extras return conflicts without constructing an invalid candidate", () => {
  const source = doc();
  const extraSlide = { ...source.slides[0], id: "extra-slide" };
  const tooManySlides = parseSlideDocument({ ...source, slides: [...source.slides, extraSlide] });
  assert.doesNotThrow(() => planOriginalModelUpgrade(tooManySlides));
  assert.equal(planOriginalModelUpgrade(tooManySlides).status, "conflict");

  const tooManyNotes = parseSlideDocument({
    ...source,
    slides: source.slides.map((slide, index) => index === 0 ? {
      ...slide,
      speakerNotes: Array.from({ length: 12 }, (_, note) => ({ id: `user-note-${note}`, kind: "talkingPoint" as const, text: `Zusatznotiz ${note}` }))
    } : slide)
  });
  assert.doesNotThrow(() => planOriginalModelUpgrade(tooManyNotes));
  assert.equal(planOriginalModelUpgrade(tooManyNotes).status, "conflict");

  const withSemanticExtra = parseSlideDocument({
    ...source,
    title: "Benutzername",
    slides: source.slides.map((slide, index) => index === 0 ? {
      ...slide,
      canvas: undefined,
      blocks: [...slide.blocks, { id: "user-paragraph", type: "paragraph" as const, text: "Eigener Inhalt" }]
    } : slide)
  });
  const plan = planOriginalModelUpgrade(withSemanticExtra);
  assert.equal(plan.status, "conflict");
  assert.ok(plan.conflicts.some((conflict) => conflict.path.includes("blocks") || conflict.path.includes("title")));
});

test("already-upgraded documents are idempotent and extra native elements remain attached", () => {
  const original = doc();
  const extra = { ...original.slides[0].canvas!.elements[0], id: "user-drawing", x: 1440, y: 24, width: 80, height: 80 };
  const edited = parseSlideDocument({
    ...original,
    assets: [...original.assets, { id: "extra-asset", kind: "figure", title: "User figure" }],
    slides: original.slides.map((slide, index) => index === 0 ? { ...slide, canvas: { ...slide.canvas!, elements: [...slide.canvas!.elements, extra] } } : slide)
  });
  const plan = planOriginalModelUpgrade(edited);
  assert.equal(plan.status, "noop");
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.preserved.canvasElementIds.includes("user-drawing"));
  assert.ok(plan.preserved.assetIds.includes("extra-asset"));
  assert.ok(applyOriginalModelUpgrade(plan).slides[0].canvas!.elements.some((element) => element.id === "user-drawing"));
  assert.equal(planOriginalModelUpgrade(doc()).status, "noop");
});

test("edited source content is surfaced as a conflict and cannot be applied", () => {
  const abbreviated = createModelDemoDocument("legacy", originalModelSlides.map((_, index) => `legacy-${index}`));
  const edited = parseSlideDocument({
    ...abbreviated,
    slides: abbreviated.slides.map((slide, index) => index === 2 ? {
      ...slide,
      blocks: slide.blocks.map((block) => block.id === "law-text" ? { ...block, text: "Eigene Bearbeitung" } : block)
    } : slide)
  });
  const plan = planOriginalModelUpgrade(edited);
  assert.equal(plan.status, "conflict");
  assert.ok(plan.conflicts.some((conflict) => conflict.path.includes("law-text")));
  assert.throws(() => applyOriginalModelUpgrade(plan), /unresolved conflict/);
  assert.equal(plan.document, edited);
});
