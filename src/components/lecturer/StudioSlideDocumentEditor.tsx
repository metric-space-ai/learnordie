"use client";

import { useMemo, useRef, useState } from "react";
import { legacySlidesToSlideDocument, scene3dSceneIdValues, slideDocumentToLegacySlides, type SlideDocument } from "@learnordie/slide-engine";
import { canvasSceneForSlide, updateSlideCanvas } from "@learnordie/slide-engine/excalidraw/scene";
import type { CanvasEmbed, CanvasScene } from "@learnordie/slide-engine/excalidraw/canvas-schema";
import type { Lecture, PresentationAsset, Slide } from "@/lib/types";
import { loadCanvasRuntime } from "@/lib/excalidraw-runtime";
import { ExcalidrawCanvas, type CanvasApi } from "../excalidraw/ExcalidrawCanvas";

type StudioSlideDocumentEditorProps = {
  lectureId: string;
  csrfToken: string;
  currentIndex: number;
  seriesTitle: string;
  slides: Slide[];
  slideDocument?: SlideDocument;
  presentationAssets?: PresentationAsset[];
  readOnly?: boolean;
  onSlideDocumentChange: (document: SlideDocument, slides: Slide[]) => void;
  onLecturesChange?: (lectures: Lecture[]) => void;
};

const initialHtml = '<article style="font-family:system-ui;color:#243f43;padding:32px;background:#fffef8"><h2>Ein Gedanke, anschaulich erklärt</h2><p>HTML und CSS für Tabellen, Formeln und besondere Inhalte.</p><div style="height:12px;background:#dcece6;border-radius:8px"><div style="width:65%;height:100%;background:#498b79;border-radius:8px"></div></div></article>';

export function StudioSlideDocumentEditor({ lectureId, currentIndex, seriesTitle, slides, slideDocument, onSlideDocumentChange, readOnly = false }: StudioSlideDocumentEditorProps) {
  const document = useMemo(() => slideDocument ?? legacySlidesToSlideDocument(slides, {
    id: `lecture:${lectureId}:deck`, title: seriesTitle, language: "de", theme: "learnordie-north"
  }), [lectureId, seriesTitle, slideDocument, slides]);
  const current = document.slides[currentIndex] ?? document.slides[0];
  const scene = useMemo(() => canvasSceneForSlide(current, document.assets), [current, document.assets]);
  const api = useRef<CanvasApi | null>(null);
  const [panel, setPanel] = useState<"html" | "scene3d" | null>(null);
  const [html, setHtml] = useState(initialHtml);
  const [sceneId, setSceneId] = useState<(typeof scene3dSceneIdValues)[number]>("modell.morph");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);

  function openEmbedPanel(kind: "html" | "scene3d") {
    if (panel === kind) { setPanel(null); return; }
    const selected = api.current?.getAppState().selectedElementIds;
    const element = api.current?.getSceneElements().find((candidate) =>
      selected && typeof selected === "object" && (selected as Record<string, unknown>)[candidate.id]
      && candidate.customData?.learnordie?.type === kind
    );
    const embed = element?.customData?.learnordie;
    setEditingElementId(element?.id ?? null);
    if (embed?.type === "html") setHtml(embed.html);
    if (embed?.type === "scene3d") setSceneId(embed.sceneId);
    setPanel(kind);
  }

  function changed(next: CanvasScene) {
    try {
      const updated = updateSlideCanvas(document, current.id, next);
      onSlideDocumentChange(updated, slideDocumentToLegacySlides(updated, slides));
      setStatus("");
    } catch {
      setStatus("Diese Änderung kann nicht gespeichert werden. Bitte kleinere Bilder oder weniger Elemente verwenden.");
    }
  }

  async function insertEmbed(embed: CanvasEmbed) {
    if (!api.current || busy) return;
    setBusy(true);
    try {
      const runtime = await loadCanvasRuntime();
      const existing = api.current.getSceneElements().find((element) => element.id === editingElementId);
      const id = existing?.id ?? `embed-${crypto.randomUUID()}`;
      const elements = existing ? api.current.getSceneElements().map((element) => element.id === id ? {
        ...element, customData: { ...element.customData, learnordie: embed }, version: Number(element.version ?? 0) + 1, updated: Date.now()
      } : element) : [...api.current.getSceneElements(), ...runtime.convertToExcalidrawElements([{
        id, type: "embeddable", x: 640, y: 260, width: 720, height: 460,
        link: `https://learnordie.invalid/embed/${id}`, customData: { learnordie: embed }
      }])];
      api.current.updateScene({ elements, appState: { selectedElementIds: { [id]: true } }, captureUpdate: "IMMEDIATELY" });
      setPanel(null);
    } catch { setStatus("Element konnte nicht eingefügt werden. Bitte erneut versuchen."); }
    finally { setBusy(false); }
  }

  return <section className="native-studio-editor" aria-label="Folie mit Excalidraw bearbeiten">
    {!readOnly && <div className="native-studio-tools" role="toolbar" aria-label="Folienelemente">
      <span className="native-studio-title">Zeichenfläche</span>
      <button type="button" onClick={() => api.current?.setActiveTool({ type: "text" })}>Text</button>
      <button type="button" onClick={() => api.current?.setActiveTool({ type: "rectangle" })}>Form</button>
      <button type="button" onClick={() => openEmbedPanel("scene3d")} aria-expanded={panel === "scene3d"}>3D-Szene</button>
      <button type="button" onClick={() => openEmbedPanel("html")} aria-expanded={panel === "html"}>HTML</button>
      <button type="button" onClick={() => api.current?.scrollToContent(undefined, { fitToContent: true, viewportZoomFactor: 0.92, animate: true })}>Einpassen</button>
    </div>}
    <ExcalidrawCanvas key={`${lectureId}:${current.id}`} title={current.title} scene={scene} readOnly={readOnly} onReady={(value) => { api.current = value; }} onChange={changed} />
    {!readOnly && panel && <aside className="native-insert-panel" aria-label={panel === "html" ? "HTML einbetten" : "3D-Szene einfügen"}>
      <div className="native-insert-heading"><h2>{panel === "html" ? "HTML einbetten" : "3D-Szene"}</h2><button type="button" aria-label="Einfügen schließen" onClick={() => setPanel(null)}>×</button></div>
      {panel === "html" ? <>
        <label>HTML und CSS<textarea aria-label="HTML und CSS" spellCheck={false} rows={9} value={html} maxLength={65536} onChange={(event) => setHtml(event.target.value)} /></label>
        <p>Isoliert eingebettet. Eigene Skripte, externe Verbindungen und Formulare werden nicht ausgeführt.</p>
        <button type="button" className="primary-button" disabled={busy || !html.trim()} onClick={() => void insertEmbed({ type: "html", html, title: "HTML-Inhalt" })}>{editingElementId ? "HTML aktualisieren" : "HTML einfügen"}</button>
      </> : <>
        <label>Szene<select aria-label="3D-Szene auswählen" value={sceneId} onChange={(event) => setSceneId(event.target.value as typeof sceneId)}>{scene3dSceneIdValues.map((id) => <option key={id} value={id}>{id.replace("modell.", "Modell · ")}</option>)}</select></label>
        <p>Interaktive three.js-Szene. Größe und Position lassen sich auf der Zeichenfläche ändern.</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void insertEmbed({ type: "scene3d", sceneId })}>{editingElementId ? "3D-Szene aktualisieren" : "3D-Szene einfügen"}</button>
      </>}
    </aside>}
    {status && <p className="native-editor-status" role="alert">{status}</p>}
  </section>;
}
