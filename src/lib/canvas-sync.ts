/** Native and schema-normalized objects have different key order. Comparing
 * JSON.stringify directly echoes every native edit back into the engine and
 * interrupts its in-progress pointer/text state. Keep array order, sort keys. */
export function canvasFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
}
export function isCanvasGestureActive(state: Record<string, unknown>): boolean {
  // Image selection first inserts a placeholder, then asynchronously attaches
  // decoded bytes. Until placement finishes, it is not a persistable image.
  return state.cursorButton === "down" || Boolean(state.pendingImageElementId || state.newElement || state.editingTextElement || state.resizingElement || state.isResizing || state.isRotating);
}

/** Zoom around the viewport centre, keeping native scene coordinates intact. */
export function canvasZoomAtCentre(state: Record<string, unknown>, factor: number) {
  const previous = Number((state.zoom as { value?: unknown } | undefined)?.value);
  const width = Number(state.width), height = Number(state.height);
  const scrollX = Number(state.scrollX), scrollY = Number(state.scrollY);
  if (![previous, width, height, scrollX, scrollY, factor].every(Number.isFinite)
    || previous <= 0 || width <= 0 || height <= 0 || factor <= 0) return null;
  const next = Math.max(0.1, Math.min(4, previous * factor));
  return {
    zoom: { value: next },
    scrollX: scrollX + width / (2 * next) - width / (2 * previous),
    scrollY: scrollY + height / (2 * next) - height / (2 * previous),
  };
}

/** Native fit rounds down in 10% steps, wasting much of a narrow viewport.
 * Preserve its centering, but clamp that rounding to the exact rotated bounds. */
export function canvasFitMinimum(elements: readonly { x: number; y: number; width: number; height: number; angle?: unknown; isDeleted?: unknown }[], width: number, height: number): number | undefined {
  if (!(width > 0 && height > 0 && width <= 700)) return undefined;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of elements) {
    if (element.isDeleted || ![element.x, element.y, element.width, element.height].every(Number.isFinite)) continue;
    const angle = typeof element.angle === "number" && Number.isFinite(element.angle) ? element.angle : 0;
    const halfWidth = (Math.abs(element.width * Math.cos(angle)) + Math.abs(element.height * Math.sin(angle))) / 2;
    const halfHeight = (Math.abs(element.width * Math.sin(angle)) + Math.abs(element.height * Math.cos(angle))) / 2;
    const x = element.x + element.width / 2, y = element.y + element.height / 2;
    left = Math.min(left, x - halfWidth); right = Math.max(right, x + halfWidth);
    top = Math.min(top, y - halfHeight); bottom = Math.max(bottom, y + halfHeight);
  }
  if (!Number.isFinite(left)) return undefined;
  return Math.max(0.1, Math.min(1, 0.92 * width / Math.max(1, right - left), 0.92 * height / Math.max(1, bottom - top)));
}
