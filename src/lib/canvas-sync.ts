/** Native and schema-normalized objects have different key order. Comparing
 * JSON.stringify directly echoes every native edit back into the engine and
 * interrupts its in-progress pointer/text state. Keep array order, sort keys. */
export function canvasFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
export function isCanvasGestureActive(state: Record<string, unknown>): boolean {
  return state.cursorButton === "down" || Boolean(state.newElement || state.editingTextElement || state.resizingElement || state.isResizing || state.isRotating);
}
