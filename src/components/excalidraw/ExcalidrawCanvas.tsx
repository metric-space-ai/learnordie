"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasElement, CanvasScene } from "@learnordie/slide-engine/excalidraw/canvas-schema";
import type { SlideAssetRef } from "@learnordie/slide-engine/schema";
import { loadCanvasRuntime } from "@/lib/excalidraw-runtime";
import { hydrateCanvasAssets } from "@/lib/canvas-assets";
import { renderCanvasEmbeddable } from "./CanvasEmbed";
import { canvasFingerprint, canvasFitMinimum, isCanvasGestureActive } from "@/lib/canvas-sync";
import { useAppTheme } from "@/components/theme/ThemeProvider";

export type CanvasApi = {
  getSceneElements: () => readonly CanvasElement[];
  getFiles: () => CanvasScene["files"];
  addFiles: (files: readonly CanvasScene["files"][string][]) => void;
  getAppState: () => Record<string, unknown>;
  updateScene: (scene: Record<string, unknown>) => void;
  scrollToContent: (elements?: readonly CanvasElement[], options?: Record<string, unknown>) => void;
  setActiveTool: (tool: { type: string }) => void;
};

export function ExcalidrawCanvas({ scene, assets = [], readOnly = false, title, slideId, onChange, onReady }: {
  scene: CanvasScene;
  assets?: SlideAssetRef[];
  readOnly?: boolean;
  title: string;
  slideId?: string;
  onChange?: (scene: CanvasScene) => boolean | void;
  onReady?: (api: CanvasApi | null) => void;
}) {
  const { theme } = useAppTheme();
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onReady });
  const initial = useRef(scene);
  const initialTitle = useRef(title);
  const assetsRef = useRef(assets);
  const apiRef = useRef<CanvasApi | null>(null);
  const lastScene = useRef(canvasFingerprint(scene));
  const mountRef = useRef<{ update(props: object): void; unmount(): void } | null>(null);
  const propsRef = useRef<Record<string, unknown>>({});
  const themeRef = useRef(theme);
  const [failure, setFailure] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [assetWarning, setAssetWarning] = useState("");

  useLayoutEffect(() => {
    themeRef.current = theme;
    if (mountRef.current) {
      propsRef.current = { ...propsRef.current, theme };
      mountRef.current.update(propsRef.current);
    }
  }, [theme]);

  useLayoutEffect(() => {
    callbacks.current = { onChange, onReady };
    initial.current = scene;
    assetsRef.current = assets;
  }, [onChange, onReady, scene, assets]);

  useEffect(() => {
    let cancelled = false;
    let handle: { unmount(): void } | undefined;
    let resize: ResizeObserver | undefined;
    let frame = 0;
    const abort = new AbortController();
    setFailure("");
    setReady(false);
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const api = apiRef.current;
        if (!api) return;
        const state = api.getAppState();
        api.scrollToContent(undefined, {
          fitToContent: true, viewportZoomFactor: 0.92, animate: false,
          minZoom: canvasFitMinimum(api.getSceneElements(), Number(state.width), Number(state.height))
        });
      });
    };
    void loadCanvasRuntime().then(async (runtime) => {
      const hydrated = await hydrateCanvasAssets(initial.current, assetsRef.current, abort.signal);
      if (cancelled || !host.current) return;
      const currentScene = hydrated.scene;
      setAssetWarning(hydrated.failed.length ? `Bildimport nicht möglich: ${hydrated.failed.join(", ")}. Originaldateien bleiben erhalten.` : "");
      let initialized = false;
      propsRef.current = {
        initialData: {
          elements: currentScene.elements,
          files: currentScene.files,
          appState: { viewBackgroundColor: currentScene.backgroundColor, currentItemFontFamily: 5, currentItemStrokeColor: "#243f43", currentItemRoughness: 1, gridSize: null },
          scrollToContent: true
        },
        name: initialTitle.current,
        theme: themeRef.current,
        langCode: "de-DE",
        viewModeEnabled: readOnly,
        zenModeEnabled: readOnly,
        handleKeyboardGlobally: false,
        autoFocus: false,
        aiEnabled: false,
        isCollaborating: false,
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false, clearCanvas: !readOnly }, tools: { image: !readOnly } },
        renderEmbeddable: (element: CanvasElement) => renderCanvasEmbeddable(runtime, element),
        excalidrawAPI: (api: CanvasApi) => {
          if (cancelled) return;
          apiRef.current = api;
          callbacks.current.onReady?.(api);
          setReady(true);
          fit();
        },
        onChange: (elements: readonly CanvasElement[], state: Record<string, unknown>, files: CanvasScene["files"]) => {
          if (cancelled || readOnly || isCanvasGestureActive(state)) return;
          // Excalidraw retains unused files for undo. Persist only files that
          // belong to visible images; the runtime still owns its undo cache.
          const usedFiles = new Set(elements.filter((element) => element.type === "image" && !element.isDeleted).map((element) => element.fileId));
          const next = { ...currentScene, elements: [...elements], files: Object.fromEntries(Object.entries(files).filter(([id]) => usedFiles.has(id))), backgroundColor: typeof state.viewBackgroundColor === "string" ? state.viewBackgroundColor : currentScene.backgroundColor };
          const serialized = canvasFingerprint(next);
          // The first native callback normalizes imported geometry/font metrics.
          // Opening a lecture is not a user edit and must not mark it dirty.
          if (!initialized) { initialized = true; lastScene.current = serialized; return; }
          if (serialized === lastScene.current) return;
          const previous = lastScene.current;
          lastScene.current = serialized;
          // The native runtime includes optional fields with value undefined.
          // Normalize to the same JSON boundary used by the save API before
          // schema validation; undefined is not a persisted element value.
          if (callbacks.current.onChange?.(JSON.parse(serialized) as CanvasScene) === false) {
            // Never leave an unpersistable drawing on screen while Save writes
            // an older document. The editor explains why this edit was rejected.
            lastScene.current = previous;
            const accepted = JSON.parse(previous) as CanvasScene;
            apiRef.current?.updateScene({ elements: accepted.elements, appState: { viewBackgroundColor: accepted.backgroundColor }, captureUpdate: "NEVER" });
          }
        }
      };
      handle = runtime.mountExcalidraw(host.current, propsRef.current);
      mountRef.current = handle as typeof mountRef.current;
      resize = new ResizeObserver(fit);
      resize.observe(host.current);
    }).catch((error: unknown) => { if (!cancelled) setFailure(error instanceof Error ? error.message : "Die Zeichenfläche konnte nicht geladen werden."); });
    return () => {
      cancelled = true;
      abort.abort();
      cancelAnimationFrame(frame);
      resize?.disconnect();
      callbacks.current.onReady?.(null);
      apiRef.current = null;
      mountRef.current = null;
      handle?.unmount();
    };
  }, [attempt, readOnly]);

  // External edits (e.g. an accepted AI patch) reach the mounted native scene.
  useEffect(() => {
    const serialized = canvasFingerprint(scene);
    if (serialized === lastScene.current) return;
    lastScene.current = serialized;
    initial.current = scene;
    apiRef.current?.addFiles(Object.values(scene.files));
    apiRef.current?.updateScene({ elements: scene.elements, appState: { viewBackgroundColor: scene.backgroundColor } });
  }, [scene]);

  return <div className={`native-canvas ${readOnly ? "native-canvas-view" : "native-canvas-edit"}`} data-canvas-engine="excalidraw" data-canvas-ready={ready} data-slide-id={slideId} aria-label={readOnly ? `Folie: ${title}` : "Excalidraw-Folieneditor"}>
    <div className="native-canvas-host" ref={host} />
    {readOnly && <section className="native-canvas-transcript" aria-label="Folieninhalt als Text">
      {scene.elements.filter((element) => element.type === "text" && !element.isDeleted && element.opacity !== 0).map((element) =>
        <p key={element.id}>{element.originalText ?? element.text}</p>
      )}
    </section>}
    {assetWarning && ready && <p className="native-asset-warning" role="status">{assetWarning}</p>}
    {failure ? <div className="native-canvas-notice" role="alert">{failure}<button type="button" onClick={() => setAttempt((value) => value + 1)}>Erneut laden</button></div>
      : !ready && <p className="native-canvas-notice" role="status">Zeichenfläche wird geladen …</p>}
  </div>;
}
