"use client";

import { Component, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { scene3dSceneIdValues, type Scene3DSceneId } from "@learnordie/slide-engine/schema";
import { Scene3DBlockRenderer } from "../../../packages/slide-engine/src/components/Scene3DBlockRenderer";
import type { CanvasElement, CanvasRuntime } from "@/lib/excalidraw-runtime";

export const MAX_CANVAS_HTML_LENGTH = 65_536;
export const CANVAS_HTML_SANDBOX = "";
export const CANVAS_HTML_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";

type SceneEmbed = { type: "scene3d"; sceneId: Scene3DSceneId; caption?: string; accent?: string };
type HtmlEmbed = { type: "html"; html: string; title: string };
export type CanvasEmbedData = SceneEmbed | HtmlEmbed;

/** Revalidate at the rendering boundary; persisted/imported scenes are untrusted. */
export function parseCanvasEmbed(element: CanvasElement): CanvasEmbedData | null {
  if (element.type !== "embeddable") return null;
  const data = element.customData?.learnordie;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.type === "html" && typeof value.html === "string" && value.html.length <= MAX_CANVAS_HTML_LENGTH) {
    return { type: "html", html: value.html, title: typeof value.title === "string" ? value.title.slice(0, 240) : "HTML/CSS-Inhalt" };
  }
  if (value.type === "scene3d" && typeof value.sceneId === "string" && (scene3dSceneIdValues as readonly string[]).includes(value.sceneId)) {
    return {
      type: "scene3d", sceneId: value.sceneId as Scene3DSceneId,
      caption: typeof value.caption === "string" ? value.caption.slice(0, 240) : undefined,
      accent: typeof value.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(value.accent) ? value.accent : undefined,
    };
  }
  return null;
}

const ALLOWED_HTML_TAGS = new Set("div span section article aside header footer main nav p h1 h2 h3 h4 h5 h6 strong b em i u s del small sub sup mark code pre blockquote q abbr time address br hr ul ol li dl dt dd table caption thead tbody tfoot tr th td colgroup col figure figcaption img details summary progress meter style svg g path circle ellipse rect line polyline polygon text tspan defs lineargradient radialgradient stop clippath title desc".split(" "));
const ALLOWED_HTML_ATTRIBUTES = new Set("class id style title lang dir role width height alt colspan rowspan scope start reversed open value min max low high optimum datetime viewbox d x y x1 y1 x2 y2 cx cy r rx ry points fill stroke stroke-width opacity transform offset stop-color stop-opacity preserveaspectratio".split(" "));

/**
 * Parse into an INERT, detached template, never into the application's mounted DOM.
 * No script (including event attributes), link, form, refresh, remote URL, nested
 * frame, or active SVG is retained. CSP + opaque sandbox are independent layers.
 */
export function buildCanvasHtmlDocument(html: string): string {
  if (html.length > MAX_CANVAS_HTML_LENGTH) throw new Error("HTML-Inhalt ist zu groß (maximal 65.536 Zeichen).");
  const template = document.createElement("template");
  template.innerHTML = html;
  const visit = (parent: ParentNode, depth: number) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 8) { node.remove(); continue; }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const tag = element.localName.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(tag) || depth > 32) { element.remove(); continue; }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const dataImage = tag === "img" && name === "src" && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(attribute.value);
        if (!dataImage && !ALLOWED_HTML_ATTRIBUTES.has(name) && !/^aria-[a-z-]+$/.test(name)) element.removeAttribute(attribute.name);
      }
      visit(element, depth + 1);
    }
  };
  visit(template.content, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CANVAS_HTML_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;box-sizing:border-box}body{padding:16px;font-family:system-ui,sans-serif;color:#20252b;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:inherit}img,svg{max-width:100%}</style></head><body>${template.innerHTML}</body></html>`;
}

class EmbedErrorBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div role="alert">Die Einbettung konnte nicht geladen werden. <button type="button" onClick={() => this.setState({ failed: false })}>Erneut versuchen</button></div>
      : this.props.children;
  }
}

function EmbedContent({ element }: { element: CanvasElement }) {
  const data = parseCanvasEmbed(element);
  if (!data) return <div role="note">Diese Einbettung wird nicht unterstützt.</div>;
  if (data.type === "html") {
    return <iframe
      className="learnordie-canvas-html"
      title={data.title || "HTML/CSS-Inhalt"}
      sandbox={CANVAS_HTML_SANDBOX}
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; usb 'none'"
      srcDoc={buildCanvasHtmlDocument(data.html)}
      style={{ width: "100%", height: "100%", display: "block", border: 0, background: "white" }}
    />;
  }
  return <div className="learnordie-canvas-scene" style={{ width: "100%", height: "100%", overflow: "auto" }}>
    <Scene3DBlockRenderer block={{
      id: element.id, type: "scene3d", sceneId: data.sceneId,
      altText: data.caption || `Interaktive 3D-Demonstration: ${data.sceneId}`,
      caption: data.caption, accent: data.accent,
    }} />
  </div>;
}

// A stable class adapter is rendered by VENDOR React, but invokes NO hooks.
// The DOM leaf owns a separate MAIN React root. Hooks in Scene3DBlockRenderer
// therefore see the matching dispatcher. Root disposal waits until the vendor
// commit has completed, avoiding nested synchronous-unmount React warnings.
const bridgeTypes = new WeakMap<CanvasRuntime, typeof Component<{ element: CanvasElement }>>();

export function renderCanvasEmbeddable(runtime: CanvasRuntime, element: CanvasElement): ReactNode {
  let Bridge = bridgeTypes.get(runtime);
  if (!Bridge) {
    class CanvasEmbedBridge extends Component<{ element: CanvasElement }> {
      host: HTMLDivElement | null = null;
      root: Root | null = null;
      captureHost = (node: HTMLDivElement | null) => { this.host = node; };
      componentDidMount() {
        if (!this.host) return;
        this.root = createRoot(this.host);
        this.paint();
      }
      componentDidUpdate() { this.paint(); }
      componentWillUnmount() {
        const ownedRoot = this.root;
        this.root = null;
        if (ownedRoot) queueMicrotask(() => ownedRoot.unmount());
      }
      paint() {
        this.root?.render(createElement(EmbedErrorBoundary, { key: this.props.element.id }, createElement(EmbedContent, { element: this.props.element })));
      }
      render() {
        return runtime.createElement("div", {
          ref: this.captureHost,
          className: "learnordie-canvas-embed-host",
          "data-canvas-embed-id": this.props.element.id,
          style: { width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", background: "transparent" },
        }) as ReactNode;
      }
    }
    Bridge = CanvasEmbedBridge;
    bridgeTypes.set(runtime, Bridge);
  }
  // Never return null: that would activate Excalidraw's generic external iframe.
  return runtime.createElement(Bridge, { key: element.id, element }) as ReactNode;
}
