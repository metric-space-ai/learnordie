"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasElement, CanvasScene } from "@learnordie/slide-engine/excalidraw/canvas-schema";
import type { SlideAssetRef } from "@learnordie/slide-engine/schema";
import { loadCanvasRuntime } from "@/lib/excalidraw-runtime";
import { hydrateCanvasAssets } from "@/lib/canvas-assets";
import { renderCanvasEmbeddable } from "./CanvasEmbed";

export type CanvasApi = {
  getSceneElements: () => readonly CanvasElement[];
  getFiles: () => CanvasScene["files"];
  addFiles: (files: readonly CanvasScene["files"][string][]) => void;
  getAppState: () => Record<string, unknown>;
  updateScene: (scene: Record<string, unknown>) => void;
  scrollToContent: (elements?: readonly CanvasElement[], options?: Record<string, unknown>) => void;
  setActiveTool: (tool: { type: string }) => void;
};

export function ExcalidrawCanvas({ scene, assets = [], readOnly = false, title, onChange, onReady }: {
  scene: CanvasScene;
  assets?: SlideAssetRef[];
  readOnly?: boolean;
  title: string;
  onChange?: (scene: CanvasScene) => void;
  onReady?: (api: CanvasApi | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onReady });
  callbacks.current = { onChange, onReady };
  const initial = useRef(scene);
  initial.current = scene;
  const initialTitle = useRef(title);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const apiRef = useRef<CanvasApi | null>(null);
  const lastScene = useRef(JSON.stringify(scene));
  const [failure, setFailure] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [assetWarning, setAssetWarning] = useState("");

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
      frame = requestAnimationFrame(() => apiRef.current?.scrollToContent(undefined, {
        fitToContent: true, viewportZoomFactor: 0.92, animate: false
      }));
    };
    void loadCanvasRuntime().then(async (runtime) => {
      const hydrated = await hydrateCanvasAssets(initial.current, assetsRef.current, abort.signal);
      if (cancelled || !host.current) return;
      const currentScene = hydrated.scene;
      setAssetWarning(hydrated.failed.length ? `Bildimport nicht möglich: ${hydrated.failed.join(", ")}. Originaldateien bleiben erhalten.` : "");
      handle = runtime.mountExcalidraw(host.current, {
        initialData: {
          elements: currentScene.elements,
          files: currentScene.files,
          appState: { viewBackgroundColor: currentScene.backgroundColor, currentItemFontFamily: 5, currentItemStrokeColor: "#243f43", currentItemRoughness: 1, gridSize: null },
          scrollToContent: true
        },
        name: initialTitle.current,
        theme: "light",
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
          if (cancelled || readOnly) return;
          const next = { ...currentScene, elements: [...elements], files, backgroundColor: typeof state.viewBackgroundColor === "string" ? state.viewBackgroundColor : currentScene.backgroundColor };
          const serialized = JSON.stringify(next);
          if (serialized === lastScene.current) return;
          lastScene.current = serialized;
          callbacks.current.onChange?.(next);
        }
      });
      resize = new ResizeObserver(fit);
      resize.observe(host.current);
    }).catch(() => { if (!cancelled) setFailure("Die Zeichenfläche konnte nicht geladen werden."); });
    return () => {
      cancelled = true;
      abort.abort();
      cancelAnimationFrame(frame);
      resize?.disconnect();
      callbacks.current.onReady?.(null);
      apiRef.current = null;
      handle?.unmount();
    };
  }, [attempt, readOnly]);

  // External edits (e.g. an accepted AI patch) reach the mounted native scene.
  useEffect(() => {
    const serialized = JSON.stringify(scene);
    if (serialized === lastScene.current) return;
    lastScene.current = serialized;
    initial.current = scene;
    apiRef.current?.addFiles(Object.values(scene.files));
    apiRef.current?.updateScene({ elements: scene.elements, appState: { viewBackgroundColor: scene.backgroundColor } });
  }, [scene]);

  return <div className={`native-canvas ${readOnly ? "native-canvas-view" : "native-canvas-edit"}`} data-canvas-engine="excalidraw" data-canvas-ready={ready} aria-label={readOnly ? `Folie: ${title}` : "Excalidraw-Folieneditor"}>
    <div className="native-canvas-host" ref={host} />
    {assetWarning && ready && <p className="native-asset-warning" role="status">{assetWarning}</p>}
    {failure ? <div className="native-canvas-notice" role="alert">{failure}<button type="button" onClick={() => setAttempt((value) => value + 1)}>Erneut laden</button></div>
      : !ready && <p className="native-canvas-notice" role="status">Zeichenfläche wird geladen …</p>}
  </div>;
}
