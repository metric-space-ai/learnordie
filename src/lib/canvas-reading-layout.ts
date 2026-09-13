import type { CanvasElement, CanvasScene } from "@learnordie/slide-engine/excalidraw/canvas-schema";

/** Reflow only independent prose/embeds. Spatial diagrams stay on their canvas.
 * Read current native elements, not the potentially older semantic blocks.
 * This function never edits the saved scene or drops user-authored drawings.
 */
export function canvasReadingElements(scene: CanvasScene, slideId: string): CanvasElement[] | null {
  const visible = scene.elements.filter(element => !element.isDeleted && element.opacity !== 0);
  const content = visible.filter(element => !(element.id === `${slideId}:underline` && element.type === "line" && !element.boundElements?.length));
  const groupSizes = new Map<string, number>();
  for (const element of content) for (const group of element.groupIds ?? []) groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
  if (!content.length || content.some(element =>
    !["text", "embeddable"].includes(element.type) || element.angle || element.frameId ||
    element.groupIds?.some(group => groupSizes.get(group)! > 1) || element.boundElements?.length || element.containerId ||
    (element.type === "text" && element.link)
  )) return null;
  // Side-by-side prose is read one column at a time. A full-width source/footer
  // remains last; within each column retain the author's vertical ordering.
  const visual = content.find(element => element.type === "embeddable");
  const column = (element: CanvasElement) => {
    if (!visual) return 0;
    if (element.y >= visual.y + visual.height && element.width > scene.width * .75) return 2;
    return element.x >= visual.x - 24 ? 1 : 0;
  };
  return [...content].sort((a, b) => column(a) - column(b) || a.y - b.y || a.x - b.x);
}
