import { parseSlideDocument, type SlideBlock, type SlideDocument, type SlideNode, type CanvasElement, type SpeakerNote } from "@learnordie/slide-engine/schema";
import { canvasSceneForSlide } from "@learnordie/slide-engine/excalidraw/scene";
import { originalModelSlides, originalModelCompanion, originalModelSourcesHtml, originalModelProvenance } from "./model-original-source";
import { createModelDemoDocument, MODEL_DEMO_KEY } from "./model-demo-template";

export const MODEL_ORIGINAL_KEY = "learnordie:model-original:clean-v1";
export const MODEL_ORIGINAL_TITLE = "Der Begriff „Modell“ im Wandel der Zeit";
export const MODEL_ORIGINAL_SERIES_TITLE = "Modellbegriff · Originalvorlesung";
export const MODEL_ORIGINAL_SLIDE_COUNT = originalModelSlides.length;
const MODEL_ORIGINAL_LEGACY_IMPORT_KEY = "modellbegriff-threejs-html-import-v1";

// Static labels from extra()/updateUI() in the original HTML. Dynamic values
// and controls remain owned by the existing scene renderer/state port.
export const MODEL_ORIGINAL_SCENE_LABELS = {
  morph: "", miniature: "",
  law: "x(t) = A · cos(√(k/m) · t)\nm = 1 kg · A = 0,65 m",
  limits: "Die Rückstellkraft wirkt der Auslenkung entgegen.\nDie Energie wechselt ihre Form; die Summe bleibt konstant.",
  runtime: "y = 60° · x", learning: "Beispieldaten · Modell · Auswertung",
  language: "Kandidaten und Werte sind didaktisch gesetzt.", transfer: ""
} as const;

/** Source markup becomes editable text, not an HTML image or executable embed.
 * Preserve the title's authored line break and mathematical subscript θ.
 */
export function originalModelText(html: string): string {
  return html.replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<sub>θ<\/sub>/g, "_θ")
    .replace(/<\/(?:p|h3)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").trim();
}

function placeText(element: CanvasElement, x: number, y: number, width: number, fontSize: number) {
  const original = element.originalText ?? element.text ?? "";
  const limit = Math.floor(width / (fontSize * 0.62));
  const lines = original.split("\n").flatMap((line) => {
    const output: string[] = [];
    let rest = line;
    while (rest.length > limit) {
      const boundary = rest.lastIndexOf(" ", limit);
      const length = boundary > 0 ? boundary : limit;
      output.push(rest.slice(0, length));
      rest = rest.slice(length + (rest[length] === " " ? 1 : 0));
    }
    return [...output, rest];
  });
  Object.assign(element, { x, y, width, height: lines.length * fontSize * 1.3, fontSize, lineHeight: 1.3, text: lines.join("\n"), originalText: original });
}

// These are author fields, not newly written teaching examples. Each field has
// its own editable native element. The full handout remains a distinct source
// document: it is not silently substituted for the eight authored slides.
export function createOriginalModelDocument(lectureId: string, slideIds: readonly string[]): SlideDocument {
  if (slideIds.length !== MODEL_ORIGINAL_SLIDE_COUNT || new Set(slideIds).size !== MODEL_ORIGINAL_SLIDE_COUNT) {
    throw new Error("The original lecture requires eight distinct slide IDs.");
  }
  const slides = originalModelSlides.map((source, index): SlideNode => {
    const key = `original-${source.scene}`;
    const textFields = ["kicker", "lead", "formula", "takeaway", "question", "sceneTitle", "sceneSub", "source"] as const;
    const slide: SlideNode = {
      id: slideIds[index], title: originalModelText(source.title), layout: "technical_figure_right", intent: index === 0 ? "title" : "explanation",
      blocks: [
        ...textFields.map((field) => ({ id: `${key}-${field}`, type: "paragraph" as const, text: originalModelText(source[field]) })),
        ...(MODEL_ORIGINAL_SCENE_LABELS[source.scene] ? [{ id: `${key}-extra`, type: "paragraph" as const, text: MODEL_ORIGINAL_SCENE_LABELS[source.scene] }] : []),
        { id: `${key}-scene`, type: "scene3d", sceneId: `modell.${source.scene}`, altText: source.sceneTitle, caption: source.sceneSub, accent: source.accent }
      ],
      speakerNotes: [
        ...originalModelText(source.notes).split(/\n\n/).map((text, n) => ({ id: `${key}-note-${n}`, kind: "talkingPoint" as const, text })),
        { id: `${key}-companion`, kind: "source", text: `Vollständiges Begleitskript: Kapitel ${index + 1}, einschließlich Herleitungen und Präzisierungen; Vertiefungen A–F im separaten Quelldokument. ${originalModelProvenance.companion.file}` }
      ],
      sourceRefs: [
        { id: `${key}-source`, sourceType: "import", label: source.source, slide: index + 1, assetId: "model-original-html", locator: `${originalModelProvenance.html.file}#MODELL_SLIDES[${index}]` },
        { id: `${key}-handout`, sourceType: "asset", label: `Begleitskript · Kapitel ${index + 1} und Vertiefungen A–F`, assetId: "model-original-companion", locator: `${originalModelProvenance.companion.file}#${index + 1}` }
      ]
    };
    const canvas = canvasSceneForSlide(slide);
    // The generic block migrator vertically stacks text and shrinks the whole
    // body when it overflows. This authored composition instead reserves two
    // columns and a fixed scene area, with no truncation or screenshot flattening.
    canvas.elements = canvas.elements.filter((element) => element.id !== `${slide.id}:underline`);
    const title = canvas.elements.find((element) => element.id === `${slide.id}:title`)!;
    placeText(title, 64, 88, 640, 50);
    const positions: Record<typeof textFields[number], [number, number, number, number]> = {
      kicker: [64, 40, 640, 20], lead: [64, 255, 610, 28], formula: [64, 452, 610, 26],
      takeaway: [64, 582, 610, 26], question: [64, 716, 610, 23],
      sceneTitle: [730, 114, 800, 27], sceneSub: [730, 194, 800, 18], source: [64, 853, 1472, 16]
    };
    for (const field of textFields) {
      const element = canvas.elements.find((item) => item.customData?.sourceBlockId === `${key}-${field}`)!;
      placeText(element, ...positions[field]);
    }
    const embed = canvas.elements.find((element) => element.type === "embeddable")!;
    Object.assign(embed, { x: 730, y: 250, width: 800, height: 540 });
    const extra = canvas.elements.find((element) => element.customData?.sourceBlockId === `${key}-extra`);
    if (extra) placeText(extra, 730, 800, 800, 18);
    slide.canvas = canvas;
    return slide;
  });
  return parseSlideDocument({
    schemaVersion: "learnordie.slide.v1", id: `lecture:${lectureId}:deck`, title: MODEL_ORIGINAL_TITLE,
    language: "de", aspect: "16:9", theme: "learnordie-technical",
    deckSettings: { defaultTransition: "fade", showSlideNumbers: true, allowFragments: false, mobileMode: "reflow" },
    createdBy: { mode: "import", promptVersion: MODEL_ORIGINAL_KEY }, slides,
    assets: [
      { id: "model-original-html", kind: "sourceDocument", title: originalModelProvenance.html.file,
        description: "Alle 13 Autorenfelder pro Originalfolie und vollständiger Quellendialog. HTML nur als nicht ausführbare Provenienzdaten.",
        structuredData: { slides: originalModelSlides, sourcesHtml: originalModelSourcesHtml, provenance: originalModelProvenance.html } },
      { id: "model-original-companion", kind: "sourceDocument", title: "Vollständige Vorlesungsunterlage · Kapitel 1–8 und A–F",
        description: "Ungekürztes Begleitskript mit Herleitungen, Aufgaben, Lösungen, Ablauf, Glossar und Quellen. Getrennt von den acht Originalfolien.",
        structuredData: { format: "text/markdown", text: originalModelCompanion, provenance: originalModelProvenance.companion } }
    ]
  });
}

export type OriginalModelSourceField = "nav" | "kicker" | "title" | "lead" | "formula" | "takeaway" | "question" | "scene" | "sceneTitle" | "sceneSub" | "accent" | "source" | "notes";
export type OriginalModelCoverageStatus = "preserved" | "added" | "conflict";
export type OriginalModelFieldEvidence = {
  slideId: string;
  sourceIndex: number;
  scene: string;
  field: OriginalModelSourceField;
  target: string;
  status: OriginalModelCoverageStatus;
};
export type OriginalModelUpgradeConflict = {
  code: "source_edit" | "slide_identity" | "block_id" | "asset_collision" | "capacity";
  path: string;
  slideId?: string;
  message: string;
};
export type OriginalModelUpgradePlan = {
  status: "ready" | "noop" | "conflict";
  document: SlideDocument;
  conflicts: OriginalModelUpgradeConflict[];
  coverage: OriginalModelFieldEvidence[];
  preserved: {
    slideIds: string[];
    quizAnchorIds: string[];
    assetIds: string[];
    canvasElementIds: string[];
  };
  source: {
    key: typeof MODEL_ORIGINAL_KEY;
    html: string;
    companion: string;
    slideCount: number;
    fieldsPerSlide: readonly string[];
  };
};

const originalSourceFields = ["nav", "kicker", "title", "lead", "formula", "takeaway", "question", "scene", "sceneTitle", "sceneSub", "accent", "source", "notes"] as const;
const nativeBlockFields = ["kicker", "lead", "formula", "takeaway", "question", "sceneTitle", "sceneSub", "source"] as const;
const MODEL_ORIGINAL_LEGACY_LANGUAGE_FORMULA = originalModelText(originalModelSlides.find((source) => source.scene === "language")!.formula).replace("p_θ", "pθ");

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>, rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length && keys.every((key) => Object.hasOwn(rightRecord, key) && jsonEqual(leftRecord[key], rightRecord[key]));
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function blockText(block: SlideBlock): string | undefined {
  return "text" in block && typeof block.text === "string" ? block.text : undefined;
}

function sceneBlock(slide: SlideNode) {
  return slide.blocks.find((block) => block.type === "scene3d");
}

function fieldBlockIds(slide: SlideNode, scene: string, source?: (typeof originalModelSlides)[number]): Partial<Record<(typeof nativeBlockFields)[number], string>> {
  const result: Partial<Record<(typeof nativeBlockFields)[number], string>> = {};
  const canonicalPrefix = `original-${scene}-`;
  for (const field of nativeBlockFields) {
    const canonical = slide.blocks.find((block) => block.id === `${canonicalPrefix}${field}`);
    if (canonical) result[field] = canonical.id;
  }
  const legacyText = slide.blocks.find((block) => block.id === `${scene}-text`);
  const legacyTask = slide.blocks.find((block) => block.id === `${scene}-task`);
  if (legacyText && !result.lead) result.lead = legacyText.id;
  if (legacyTask && !result.question) result.question = legacyTask.id;
  for (const field of nativeBlockFields) {
    if (result[field]) continue;
    const suffixed = slide.blocks.find((block) => block.id.endsWith(`-${field}`));
    if (suffixed) result[field] = suffixed.id;
  }
  if (source) {
    for (const field of nativeBlockFields) {
      if (result[field]) continue;
      const matching = slide.blocks.find((block) => blockText(block) === expectedBlockText(source, field));
      if (matching) result[field] = matching.id;
    }
  }
  const heading = slide.blocks.find((block) => block.type === "heading");
  const paragraph = slide.blocks.find((block) => block.type === "paragraph");
  const callout = slide.blocks.find((block) => block.type === "callout");
  if (heading && !result.kicker) result.kicker = heading.id;
  if (paragraph && !result.lead) result.lead = paragraph.id;
  if (callout && !result.formula) result.formula = callout.id;
  return result;
}

function expectedBlockText(source: (typeof originalModelSlides)[number], field: (typeof nativeBlockFields)[number]): string {
  return originalModelText(source[field]);
}

function replaceSourceBlockIds(slide: SlideNode, mapping: Map<string, string>): SlideNode {
  const remap = (id: string) => mapping.get(id) ?? id;
  const blocks = slide.blocks.map((block) => ({ ...block, id: remap(block.id) })) as SlideBlock[];
  const speakerNotes = slide.speakerNotes?.map((note) => note.blockId ? { ...note, blockId: remap(note.blockId) } : note);
  const quizAnchors = slide.quizAnchors?.map((anchor) => ({ ...anchor, blockId: remap(anchor.blockId) }));
  const canvas = slide.canvas && {
    ...slide.canvas,
    elements: slide.canvas.elements.map((element) => element.customData?.sourceBlockId && mapping.has(element.customData.sourceBlockId)
      ? { ...element, customData: { ...element.customData, sourceBlockId: remap(element.customData.sourceBlockId) } }
      : element)
  };
  return { ...slide, blocks, speakerNotes, quizAnchors, canvas };
}

function mergeById<T extends { id: string }>(existing: T[] | undefined, additions: T[], conflicts: OriginalModelUpgradeConflict[], path: string): T[] {
  const result = [...(existing ?? [])];
  const byId = new Map(result.map((item) => [item.id, item]));
  for (const addition of additions) {
    const prior = byId.get(addition.id);
    if (!prior) {
      result.push(addition);
      byId.set(addition.id, addition);
    } else if (!jsonEqual(prior, addition)) {
      conflicts.push({ code: "source_edit", path: `${path}.${addition.id}`, message: `Existing authored item ${addition.id} differs from the original source.` });
    }
  }
  return result;
}

function mergeSpeakerNotes(existing: SpeakerNote[] | undefined, additions: SpeakerNote[], conflicts: OriginalModelUpgradeConflict[], path: string): SpeakerNote[] {
  const result = [...(existing ?? [])];
  const byId = new Map(result.map((note) => [note.id, note]));
  const existingTexts = new Set(result.flatMap((note) => [note.text, ...note.text.split("\n\n")]));
  const pending: SpeakerNote[] = [];
  for (const addition of additions) {
    const prior = byId.get(addition.id);
    if (prior) {
      if (!jsonEqual(prior, addition)) conflicts.push({ code: "source_edit", path: `${path}.${addition.id}`, message: `Existing authored note ${addition.id} differs from the original source.` });
    } else if (!existingTexts.has(addition.text)) {
      pending.push(addition);
      existingTexts.add(addition.text);
    }
  }
  const bundledGroups: SpeakerNote[][] = [];
  for (const note of pending) {
    const previous = bundledGroups[bundledGroups.length - 1]?.[0];
    if (previous && previous.kind === note.kind && !previous.blockId && !note.blockId && `${bundledGroups[bundledGroups.length - 1].map((item) => item.text).join("\n\n")}\n\n${note.text}`.length <= 1600) {
      bundledGroups[bundledGroups.length - 1].push(note);
      continue;
    }
    bundledGroups.push([note]);
  }
  const usedIds = new Set([...result, ...pending].map((note) => note.id));
  const bundled = bundledGroups.map((group) => {
    if (group.length === 1) return { ...group[0] };
    let id = `${group[0].id}-bundle`;
    let suffix = 2;
    while (usedIds.has(id)) id = `${group[0].id}-bundle-${suffix++}`;
    usedIds.add(id);
    return { id, kind: group[0].kind, text: group.map((item) => item.text).join("\n\n") };
  });
  if (result.length + bundled.length > 12) conflicts.push({ code: "capacity", path, message: "Preserving existing notes and complete authored notes exceeds the native note limit." });
  return [...result, ...bundled];
}

function mergeAssets(existing: SlideDocument["assets"], additions: SlideDocument["assets"], conflicts: OriginalModelUpgradeConflict[]): SlideDocument["assets"] {
  const result = [...existing];
  const byId = new Map(result.map((asset) => [asset.id, asset]));
  const structuredText = (value: unknown) => typeof value === "string" ? value : value && typeof value === "object" && "text" in value && typeof value.text === "string" ? value.text : undefined;
  for (const addition of additions) {
    const prior = byId.get(addition.id);
    if (!prior) {
      result.push(addition);
      byId.set(addition.id, addition);
    } else if (addition.id === "model-original-companion" && structuredText(prior.structuredData) === structuredText(addition.structuredData) && structuredText(addition.structuredData)) {
      // Preserve surrounding metadata while verifying that the attached manuscript is unchanged.
    } else if (!jsonEqual(prior, addition)) {
      conflicts.push({ code: "asset_collision", path: `assets.${addition.id}`, message: `Attached asset ${addition.id} differs from the original source.` });
    }
  }
  return result;
}

function mergeCanvas(existing: SlideNode["canvas"], authored: SlideNode["canvas"], conflicts: OriginalModelUpgradeConflict[], slideId: string, preserved: string[]): SlideNode["canvas"] {
  if (!authored) return existing;
  if (!existing) return authored;
  const authoredById = new Map(authored.elements.map((element) => [element.id, element]));
  for (const element of authored.elements) {
    const current = existing.elements.find((candidate) => candidate.id === element.id);
    if (!current) conflicts.push({ code: "source_edit", path: `slides.${slideId}.canvas.elements.${element.id}`, slideId, message: `Original canvas element ${element.id} is missing.` });
    else if (!jsonEqual(current, element)) conflicts.push({ code: "source_edit", path: `slides.${slideId}.canvas.elements.${element.id}`, slideId, message: `Original canvas element ${element.id} was edited.` });
  }
  const extras = existing.elements.filter((element) => !authoredById.has(element.id));
  preserved.push(...extras.map((element) => element.id));
  const files = { ...authored.files };
  for (const [id, file] of Object.entries(existing.files)) {
    if (files[id] && !jsonEqual(files[id], file)) conflicts.push({ code: "asset_collision", path: `slides.${slideId}.canvas.files.${id}`, slideId, message: `Attached canvas file ${id} was edited.` });
    else files[id] = file;
  }
  return { ...authored, elements: [...authored.elements, ...extras], files };
}

function originalCoverage(sourceIndex: number, slide: SlideNode, blockIds: Partial<Record<(typeof nativeBlockFields)[number], string>>, statuses: Partial<Record<OriginalModelSourceField, OriginalModelCoverageStatus>>): OriginalModelFieldEvidence[] {
  const source = originalModelSlides[sourceIndex];
  const target = (field: OriginalModelSourceField) => {
    if (field === "nav" || field === "accent") return `asset:model-original-html.structuredData.slides[${sourceIndex}].${field}`;
    if (field === "title") return `slides.${slide.id}.title`;
    if (field === "scene") return `slides.${slide.id}.blocks[scene3d].sceneId`;
    if (field === "notes") return `slides.${slide.id}.speakerNotes`;
    return `slides.${slide.id}.blocks.${blockIds[field as (typeof nativeBlockFields)[number]] ?? `original-${source.scene}-${field}`}`;
  };
  return originalSourceFields.map((field) => ({ slideId: slide.id, sourceIndex, scene: source.scene, field, target: target(field), status: statuses[field] ?? "added" }));
}

/**
 * Build a non-mutating, auditable upgrade from an existing native lecture.
 * The returned candidate is only safe to persist when `conflicts` is empty.
 * Existing user content, quiz anchors, assets and canvas extras are retained;
 * changed known source content is reported instead of being overwritten.
 */
export function planOriginalModelUpgrade(existing: SlideDocument): OriginalModelUpgradePlan {
  const conflicts: OriginalModelUpgradeConflict[] = [];
  const coverage: OriginalModelFieldEvidence[] = [];
  const preservedCanvasElementIds: string[] = [];
  const preservedQuizAnchorIds: string[] = [];
  const source = {
    key: MODEL_ORIGINAL_KEY,
    html: originalModelProvenance.html.file,
    companion: originalModelProvenance.companion.file,
    slideCount: MODEL_ORIGINAL_SLIDE_COUNT,
    fieldsPerSlide: originalModelProvenance.fieldsPerSlide
  } as const;
  const finalize = (document: SlideDocument, status: OriginalModelUpgradePlan["status"]): OriginalModelUpgradePlan => ({
    status,
    document,
    conflicts,
    coverage,
    preserved: {
      slideIds: existing.slides.map((slide) => slide.id),
      quizAnchorIds: preservedQuizAnchorIds,
      assetIds: existing.assets.map((asset) => asset.id),
      canvasElementIds: preservedCanvasElementIds
    },
    source
  });
  const sourceSlides = new Map(originalModelSlides.map((source) => [`modell.${source.scene}`, source]));
  const legacyIds = existing.slides.map((slide) => slide.id);
  if (existing.slides.length !== MODEL_ORIGINAL_SLIDE_COUNT) {
    conflicts.push({ code: "slide_identity", path: "slides", message: `Expected ${MODEL_ORIGINAL_SLIDE_COUNT} original slides, received ${existing.slides.length}.` });
    return finalize(existing, "conflict");
  }
  const legacyBaseline = existing.createdBy.promptVersion === MODEL_DEMO_KEY ? createModelDemoDocument("legacy", legacyIds) : undefined;
  const candidateBase = createOriginalModelDocument("upgrade", legacyIds.length === MODEL_ORIGINAL_SLIDE_COUNT ? legacyIds : originalModelSlides.map((_, index) => `upgrade-slide-${index}`));
  const slides = existing.slides.map((current, index): SlideNode => {
    const authored = candidateBase.slides[index];
    const expectedSource = originalModelSlides[index];
    const expectedTitle = originalModelText(expectedSource.title);
    const scene = sceneBlock(current)?.sceneId;
    if (!scene || scene !== `modell.${expectedSource.scene}` || !sourceSlides.has(scene)) {
      conflicts.push({ code: "slide_identity", path: `slides.${index}`, slideId: current.id, message: `Slide ${current.id} does not identify original scene ${expectedSource.scene}.` });
    }
    const baseline = legacyBaseline?.slides[index];
    const mapping = new Map<string, string>();
    const statuses: Partial<Record<OriginalModelSourceField, OriginalModelCoverageStatus>> = {};
    const fieldIds = fieldBlockIds(current, expectedSource.scene, expectedSource);
    if (baseline) {
      for (const block of baseline.blocks) {
        const actual = current.blocks.find((candidate) => candidate.id === block.id);
        if (actual && !jsonEqual(actual, block)) conflicts.push({ code: "source_edit", path: `slides.${current.id}.blocks.${block.id}`, slideId: current.id, message: `Existing generated block ${block.id} was edited.` });
      }
      const baselineNotes = new Map((baseline.speakerNotes ?? []).map((note) => [note.id, note]));
      for (const note of current.speakerNotes ?? []) if (baselineNotes.has(note.id) && !jsonEqual(note, baselineNotes.get(note.id))) conflicts.push({ code: "source_edit", path: `slides.${current.id}.speakerNotes.${note.id}`, slideId: current.id, message: `Existing generated note ${note.id} was edited.` });
      if (normalizedText(current.title) !== normalizedText(baseline.title)) conflicts.push({ code: "source_edit", path: `slides.${current.id}.title`, slideId: current.id, message: "Existing generated slide title was edited." });
      const oldText = current.blocks.find((block) => block.id === `${expectedSource.scene}-text`);
      const oldTask = current.blocks.find((block) => block.id === `${expectedSource.scene}-task`);
      if (oldText) mapping.set(authored.blocks.find((block) => block.id.endsWith("-lead"))!.id, oldText.id);
      if (oldTask) mapping.set(authored.blocks.find((block) => block.id.endsWith("-question"))!.id, oldTask.id);
      const oldScene = current.blocks.find((block) => block.id === `${expectedSource.scene}-scene`);
      if (oldScene) mapping.set(authored.blocks.find((block) => block.id.endsWith("-scene"))!.id, oldScene.id);
      statuses.lead = oldText ? "preserved" : "added";
      statuses.question = oldTask ? "preserved" : "added";
      statuses.scene = oldScene ? "preserved" : "added";
    } else {
      for (const field of nativeBlockFields) {
        const existingId = fieldIds[field];
        const currentBlock = existingId ? current.blocks.find((block) => block.id === existingId) : undefined;
        if (currentBlock) {
          const matches = blockText(currentBlock) === expectedBlockText(expectedSource, field)
            || (existing.createdBy.promptVersion === MODEL_ORIGINAL_LEGACY_IMPORT_KEY && field === "formula" && expectedSource.scene === "language" && blockText(currentBlock) === MODEL_ORIGINAL_LEGACY_LANGUAGE_FORMULA);
          if (!matches) {
            conflicts.push({ code: "source_edit", path: `slides.${current.id}.blocks.${currentBlock.id}`, slideId: current.id, message: `Existing authored field ${field} differs from the original source.` });
            statuses[field] = "conflict";
          } else {
            const canonical = authored.blocks.find((block) => block.id.endsWith(`-${field}`));
            if (canonical) mapping.set(canonical.id, currentBlock.id);
            statuses[field] = "preserved";
          }
        } else statuses[field] = "added";
      }
      const sourceElement = sceneBlock(current);
      const legacySceneMetadata = existing.createdBy.promptVersion === MODEL_ORIGINAL_LEGACY_IMPORT_KEY
        && sourceElement?.altText === `${originalModelText(expectedSource.sceneTitle)}. ${originalModelText(expectedSource.sceneSub)}`
        && sourceElement.caption === undefined
        && sourceElement.accent === expectedSource.accent;
      if (sourceElement && !legacySceneMetadata && (sourceElement.altText !== originalModelText(expectedSource.sceneTitle) || sourceElement.caption !== originalModelText(expectedSource.sceneSub) || sourceElement.accent !== expectedSource.accent)) {
        conflicts.push({ code: "source_edit", path: `slides.${current.id}.blocks.${sourceElement.id}`, slideId: current.id, message: "Existing scene metadata differs from the original source." });
        statuses.sceneTitle = "conflict";
        statuses.sceneSub = "conflict";
        statuses.accent = "conflict";
      } else if (sourceElement) {
        statuses.scene = "preserved";
        statuses.sceneTitle = "preserved";
        statuses.sceneSub = "preserved";
        statuses.accent = "preserved";
        const authoredScene = sceneBlock(authored);
        if (authoredScene) mapping.set(authoredScene.id, sourceElement.id);
      }
    }
    if (normalizedText(current.title) === normalizedText(expectedTitle)) statuses.title = "preserved";
    else if (!baseline) {
      statuses.title = "conflict";
      conflicts.push({ code: "source_edit", path: `slides.${current.id}.title`, slideId: current.id, message: "Existing slide title differs from the original source." });
    }
    for (const field of nativeBlockFields) if (fieldIds[field] && !statuses[field]) statuses[field] = "preserved";
    const mapped = replaceSourceBlockIds(authored, mapping);
    const mappedBlockIds = new Set(mapped.blocks.map((block) => block.id));
    const extras = current.blocks.filter((block) => !mappedBlockIds.has(block.id));
    const mergedBlocks = [...mapped.blocks, ...extras];
    if (!current.canvas && extras.length) conflicts.push({ code: "source_edit", path: `slides.${current.id}.blocks`, slideId: current.id, message: "Existing semantic blocks have no saved native canvas and require review before upgrade." });
    const mergedNotes = mergeSpeakerNotes(current.speakerNotes, authored.speakerNotes ?? [], conflicts, `slides.${current.id}.speakerNotes`);
    if ((authored.speakerNotes ?? []).every((note) => current.speakerNotes?.some((existingNote) => existingNote.text === note.text))) statuses.notes = "preserved";
    const mergedRefs = mergeById(current.sourceRefs, authored.sourceRefs, conflicts, `slides.${current.id}.sourceRefs`);
    const quizAnchors = current.quizAnchors?.map((anchor) => {
      preservedQuizAnchorIds.push(anchor.id);
      return anchor;
    });
    if (mergedNotes.length > 12 || mergedRefs.length > 20 || mergedBlocks.length > 24) conflicts.push({ code: "capacity", path: `slides.${current.id}`, slideId: current.id, message: "Preserving existing authored content exceeds the native slide limits." });
    const slide: SlideNode = {
      ...current,
      id: current.id,
      title: normalizedText(current.title) === normalizedText(expectedTitle) || baseline ? authored.title : current.title,
      blocks: mergedBlocks,
      canvas: mergeCanvas(current.canvas, mapped.canvas, conflicts, current.id, preservedCanvasElementIds),
      speakerNotes: mergedNotes,
      sourceRefs: mergedRefs
    };
    if (quizAnchors) slide.quizAnchors = quizAnchors;
    coverage.push(...originalCoverage(index, slide, fieldBlockIds(slide, expectedSource.scene, expectedSource), statuses));
    return slide;
  });
  const assets = mergeAssets(existing.assets, candidateBase.assets, conflicts);
  if (conflicts.length) return finalize(existing, "conflict");
  const candidate = parseSlideDocument({
    ...candidateBase,
    ...existing,
    id: existing.id,
    title: MODEL_ORIGINAL_TITLE,
    slides,
    assets,
    createdBy: { mode: "import", promptVersion: MODEL_ORIGINAL_KEY }
  });
  const status = conflicts.length ? "conflict" : jsonEqual(candidate, existing) ? "noop" : "ready";
  return finalize(candidate, status);
}

export function applyOriginalModelUpgrade(plan: OriginalModelUpgradePlan): SlideDocument {
  if (plan.conflicts.length) throw new Error(`Original model upgrade has ${plan.conflicts.length} unresolved conflict(s).`);
  return plan.document;
}
