"use client";

/** Structural types keep the vendored React/Excalidraw closure outside Next's bundle. */
export type CanvasElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  customData?: Record<string, unknown> | null;
  [key: string]: unknown;
};
export type CanvasAppState = Record<string, unknown>;
export type CanvasFiles = Record<string, unknown>;
export type CanvasImperativeAPI = {
  getSceneElements(): readonly CanvasElement[];
  getAppState(): CanvasAppState;
  getFiles(): CanvasFiles;
  updateScene(scene: { elements?: readonly object[]; appState?: object; captureUpdate?: string }): void;
  scrollToContent(elements?: readonly object[], options?: object): void;
  setActiveTool(tool: { type: string }): void;
  addFiles(files: readonly object[]): void;
  refresh(): void;
};
export type CanvasRuntimeProps = {
  initialData?: object;
  excalidrawAPI?: (api: CanvasImperativeAPI) => void;
  onChange?: (elements: readonly CanvasElement[], appState: CanvasAppState, files: CanvasFiles) => void;
  renderEmbeddable?: (element: CanvasElement, appState: CanvasAppState) => unknown;
  validateEmbeddable?: (link: string) => boolean;
  onError?: (error: Error) => void;
  [key: string]: unknown;
};
export type CanvasMount = { update(props: object): void; unmount(): void };
export type CanvasRuntime = {
  mountExcalidraw(host: HTMLElement, props: object): CanvasMount;
  convertToExcalidrawElements<T extends object = CanvasElement>(elements: readonly object[], options?: { regenerateIds?: boolean }): T[];
  exportToSvg(options: { elements: readonly object[]; appState?: object; files?: object; [key: string]: unknown }): Promise<SVGSVGElement>;
  /** Creates VENDORED React nodes. Never call main-React hooks in these nodes. */
  createElement(type: unknown, props: object | null, ...children: unknown[]): unknown;
};

type RuntimeWindow = Window & {
  EXCALIDRAW_ASSET_PATH?: string;
  __learnordieCanvasModule?: CanvasRuntime;
  __learnordieCanvasModuleError?: string;
};

export const CANVAS_ASSET_PATH = "/vendor/excalidraw/";
export const CANVAS_EMBED_LINK_PREFIX = "https://learnordie.invalid/embed/";
const LOAD_TIMEOUT_MS = 20_000;
let runtimePromise: Promise<CanvasRuntime> | undefined;
let modulePromise: Promise<CanvasRuntime> | undefined;
let stylePromise: Promise<void> | undefined;
let attempt = 0;

export function isCanvasEmbedLink(link: unknown): link is string {
  return typeof link === "string" && /^https:\/\/learnordie\.invalid\/embed\/[A-Za-z0-9_.%~-]{1,512}$/.test(link);
}

function loadStyles(): Promise<void> {
  if (stylePromise) return stylePromise;
  const existing = document.getElementById("learnordie-excalidraw-css") as HTMLLinkElement | null;
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  existing?.remove();
  stylePromise = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.id = "learnordie-excalidraw-css";
    link.rel = "stylesheet";
    link.href = `${CANVAS_ASSET_PATH}excalidraw.css`;
    const timer = window.setTimeout(() => fail(), LOAD_TIMEOUT_MS);
    const clean = () => { window.clearTimeout(timer); link.onload = null; link.onerror = null; };
    const fail = () => { clean(); link.remove(); reject(new Error("Die Zeichen-Engine-Stile fehlen. Bitte erneut versuchen.")); };
    link.onload = () => { clean(); link.dataset.loaded = "true"; resolve(); };
    link.onerror = fail;
    document.head.append(link);
  }).catch((error: unknown) => { stylePromise = undefined; throw error; });
  return stylePromise;
}

async function requireFonts(): Promise<void> {
  if (!document.fonts) throw new Error("Der Browser unterstützt das Laden der Zeichen-Schriften nicht.");
  let timer = 0;
  try {
    const faces = await Promise.race([
      document.fonts.load('16px "Assistant"'),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Die lokale Schrift konnte nicht geladen werden. Bitte erneut versuchen.")), LOAD_TIMEOUT_MS);
      }),
    ]);
    if (!faces.length) throw new Error("Die lokale Assistant-Schrift fehlt. Bitte erneut versuchen.");
  } finally { window.clearTimeout(timer); }
}

function loadModule(): Promise<CanvasRuntime> {
  if (modulePromise) return modulePromise;
  const browser = window as RuntimeWindow;
  if (browser.__learnordieCanvasModule) return Promise.resolve(browser.__learnordieCanvasModule);
  modulePromise = new Promise<CanvasRuntime>((resolve, reject) => {
    delete browser.__learnordieCanvasModuleError;
    const script = document.createElement("script");
    script.type = "module";
    script.src = `/learnordie-excalidraw-loader.mjs?attempt=${++attempt}`;
    const timer = window.setTimeout(() => fail(), LOAD_TIMEOUT_MS);
    const clean = () => { window.clearTimeout(timer); script.onload = null; script.onerror = null; script.remove(); };
    const fail = () => { clean(); reject(new Error(browser.__learnordieCanvasModuleError ?? "Die lokale Zeichen-Engine konnte nicht geladen werden. Bitte erneut versuchen oder die Seite neu laden.")); };
    script.onload = () => {
      const loadedModule = browser.__learnordieCanvasModule;
      if (!loadedModule || [loadedModule.mountExcalidraw, loadedModule.createElement, loadedModule.convertToExcalidrawElements, loadedModule.exportToSvg].some((fn) => typeof fn !== "function")) return fail();
      clean(); resolve(loadedModule);
    };
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => { modulePromise = undefined; throw error; });
  return modulePromise;
}

function withLocalEmbeds<T extends object>(element: T): T {
  const candidate = element as Record<string, unknown>;
  if (candidate.type !== "embeddable") return element;
  const customData = candidate.customData as Record<string, unknown> | undefined;
  return customData?.learnordie && typeof candidate.id === "string"
    ? { ...element, link: `${CANVAS_EMBED_LINK_PREFIX}${encodeURIComponent(candidate.id)}` }
    : element;
}

function wrapRuntime(native: CanvasRuntime): CanvasRuntime {
  return {
    createElement: native.createElement,
    convertToExcalidrawElements: <T extends object = CanvasElement>(elements: readonly object[], options?: { regenerateIds?: boolean }) => native.convertToExcalidrawElements<T>(elements, options).map(withLocalEmbeds),
    // SVG remains static: never use the vendor's foreignObject/iframe export.
    exportToSvg: (options) => native.exportToSvg({ ...options, renderEmbeddables: false }),
    mountExcalidraw(host, initialProps) {
      let disposed = false;
      let props = initialProps as CanvasRuntimeProps;
      let alert: HTMLElement | undefined;
      const normalized = () => ({
        ...props,
        aiEnabled: false,
        isCollaborating: false,
        validateEmbeddable: isCanvasEmbedLink,
        renderEmbeddable: (element: CanvasElement, state: CanvasAppState) =>
          props.renderEmbeddable?.(element, state) ?? native.createElement("div", { role: "note" }, "Diese Einbettung wird nicht unterstützt."),
      });
      const mounted = native.mountExcalidraw(host, normalized());
      const failedFonts = new Set<string>();
      const showError = (event: Event) => {
        const faces = (event as Event & { fontfaces?: FontFace[] }).fontfaces ?? [];
        for (const face of faces) {
          if (/Assistant|Virgil|Excalifont|Cascadia|Comic Shanns|Liberation|Lilita|Nunito/i.test(face.family)) failedFonts.add(face.family);
        }
        if (!failedFonts.size) return;
        if (disposed || alert) return;
        const error = new Error("Eine lokale Zeichen-Schrift konnte nicht geladen werden.");
        props.onError?.(error);
        alert = document.createElement("aside");
        alert.setAttribute("role", "alert");
        alert.style.cssText = "position:absolute;inset:8px 8px auto;z-index:1000;background:#fff4d6;color:#302819;padding:12px;border:1px solid currentColor;border-radius:8px";
        alert.append(document.createTextNode(`${error.message} `));
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Schriften erneut laden";
        retry.onclick = async () => {
          retry.disabled = true;
          try {
            await requireFonts();
            for (const family of failedFonts) await document.fonts.load(`16px ${JSON.stringify(family)}`);
            failedFonts.clear();
            if (!disposed) { alert?.remove(); alert = undefined; mounted.update(normalized()); }
          } catch { retry.textContent = "Erneut versuchen / Seite neu laden"; }
          finally { retry.disabled = false; }
        };
        alert.append(retry);
        host.append(alert);
      };
      document.fonts.addEventListener("loadingerror", showError);
      return {
        update(nextProps) { if (!disposed) { props = nextProps as CanvasRuntimeProps; mounted.update(normalized()); } },
        unmount() {
          if (disposed) return;
          disposed = true;
          document.fonts.removeEventListener("loadingerror", showError);
          alert?.remove(); mounted.unmount();
        },
      };
    },
  };
}

/** One same-origin module + stylesheet load per page. Failed attempts may be explicitly retried. */
export function loadCanvasRuntime(): Promise<CanvasRuntime> {
  if (typeof window === "undefined") return Promise.reject(new Error("Die Zeichen-Engine benötigt einen Browser."));
  if (!runtimePromise) {
    (window as RuntimeWindow).EXCALIDRAW_ASSET_PATH = new URL(CANVAS_ASSET_PATH, window.location.origin).href;
    runtimePromise = Promise.all([loadModule(), loadStyles().then(requireFonts)])
      .then(([native]) => wrapRuntime(native))
      .catch((error: unknown) => { runtimePromise = undefined; throw error; });
  }
  return runtimePromise;
}
