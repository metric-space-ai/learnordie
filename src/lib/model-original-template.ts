import { parseSlideDocument, type SlideDocument, type SlideNode, type CanvasElement } from "@learnordie/slide-engine/schema";
import { canvasSceneForSlide } from "@learnordie/slide-engine/excalidraw/scene";
import { originalModelSlides, originalModelCompanion, originalModelSourcesHtml, originalModelProvenance } from "./model-original-source";

export const MODEL_ORIGINAL_KEY = "learnordie:model-original:clean-v1";
export const MODEL_ORIGINAL_TITLE = "Der Begriff „Modell“ im Wandel der Zeit";
export const MODEL_ORIGINAL_SERIES_TITLE = "Modellbegriff · Originalvorlesung";
export const MODEL_ORIGINAL_SLIDE_COUNT = originalModelSlides.length;

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
