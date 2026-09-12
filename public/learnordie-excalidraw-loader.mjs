// Browser-native ESM: never evaluated as text and never fetched from a CDN.
const attempt = new URL(import.meta.url).searchParams.get("attempt") || "0";
try {
  window.__learnordieCanvasModule = await import(`./vendor/excalidraw/runtime.mjs?attempt=${encodeURIComponent(attempt)}`);
} catch {
  window.__learnordieCanvasModuleError = "Die lokale Zeichen-Engine konnte nicht geladen werden.";
} finally {
  window.__learnordieCanvasReady?.(Number(attempt));
}
