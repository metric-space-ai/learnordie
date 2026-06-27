export type FlipOptions = {
  duration?: number;
  easing?: string;
  onFinish?: () => void;
};

type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function animateFlip(element: HTMLElement, first: RectLike, last: RectLike, options: FlipOptions = {}) {
  const width = Math.max(last.width, 1);
  const height = Math.max(last.height, 1);
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / width;
  const sy = first.height / height;

  const animation = element.animate(
    [
      { opacity: 0.88, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { opacity: 0, transform: "translate(0, 0) scale(1, 1)" }
    ],
    {
      duration: options.duration ?? 620,
      easing: options.easing ?? "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "both"
    }
  );

  animation.finished
    .then(() => options.onFinish?.())
    .catch(() => options.onFinish?.());

  return animation;
}

function rectFromTarget(target: HTMLElement, width: number, height: number, x = 0.5, y = 0.5): DOMRect {
  const box = target.getBoundingClientRect();
  return DOMRect.fromRect({
    x: box.left + box.width * x - width / 2,
    y: box.top + box.height * y - height / 2,
    width,
    height
  });
}

function createSharedGhost({
  className,
  dataset,
  label,
  rect
}: {
  className: string;
  dataset: Record<string, string>;
  label: string;
  rect: RectLike;
}) {
  const ghost = document.createElement("div");
  const labelNode = document.createElement("strong");
  ghost.className = `${className} lb-enter-shared`;
  ghost.setAttribute("aria-hidden", "true");
  for (const [key, value] of Object.entries(dataset)) {
    ghost.dataset[key] = value;
  }
  labelNode.textContent = label;
  ghost.append(labelNode);
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
  document.body.append(ghost);
  return ghost;
}

export function animateHotspotToDrawerSharedElement({
  drawer,
  level,
  originRatio,
  source
}: {
  drawer?: HTMLElement | null;
  level: string;
  originRatio: number;
  source?: HTMLElement | null;
}) {
  if (!source || !drawer || prefersReducedMotion()) return;

  const first = source.getBoundingClientRect();
  const drawerBox = drawer.getBoundingClientRect();
  if (!first.width || !first.height || !drawerBox.width || !drawerBox.height) return;

  const width = Math.max(84, Math.min(116, first.width * 1.9));
  const height = Math.max(34, first.height);
  const last = DOMRect.fromRect({
    x: drawerBox.left + drawerBox.width * originRatio - width / 2,
    y: drawerBox.top - height / 2,
    width,
    height
  });
  const ghost = createSharedGhost({
    className: "learn-hotspot-shared-ghost",
    dataset: { sharedElement: "learn-hotspot", level },
    label: level,
    rect: last
  });

  animateFlip(ghost, first, last, {
    onFinish: () => window.setTimeout(() => ghost.remove(), 80)
  });
}

export function animateStudioToolSharedElement({
  first,
  label,
  target,
  tool
}: {
  first: RectLike;
  label: string;
  target?: HTMLElement | null;
  tool: "materials" | "analytics";
}) {
  if (!target || prefersReducedMotion()) return;

  const width = tool === "analytics" ? 132 : 118;
  const height = 44;
  const last = rectFromTarget(target, width, height, 0.82, 0.08);
  const ghost = createSharedGhost({
    className: "studio-tool-shared-ghost",
    dataset: { sharedElement: tool === "materials" ? "studio-sources" : "studio-analytics", tool },
    label,
    rect: last
  });

  animateFlip(ghost, first, last, {
    duration: 560,
    onFinish: () => window.setTimeout(() => ghost.remove(), 80)
  });
}

export function animateStudioInsightSharedElement({
  kind,
  label,
  source,
  target
}: {
  kind: "slide" | "question";
  label: string;
  source?: HTMLElement | null;
  target?: HTMLElement | null;
}) {
  if (!source || !target || prefersReducedMotion()) return;

  const first = source.getBoundingClientRect();
  if (!first.width || !first.height) return;

  const last = rectFromTarget(target, Math.min(220, Math.max(150, first.width * 0.78)), 58, 0.5, kind === "slide" ? 0.62 : 0.42);
  const ghost = createSharedGhost({
    className: "studio-insight-shared-ghost",
    dataset: { sharedElement: kind === "slide" ? "studio-insight-slide" : "studio-insight-question", kind },
    label,
    rect: last
  });

  animateFlip(ghost, first, last, {
    duration: 560,
    onFinish: () => window.setTimeout(() => ghost.remove(), 80)
  });
}

export function animateStudioSlideSharedElement({
  source,
  target,
  index,
  title
}: {
  source?: HTMLElement | null;
  target?: HTMLElement | null;
  index: number;
  title: string;
}) {
  if (!source || !target || prefersReducedMotion()) return;

  const first = source.getBoundingClientRect();
  const last = target.getBoundingClientRect();
  if (!first.width || !first.height || !last.width || !last.height) return;

  const ghost = document.createElement("div");
  const number = document.createElement("span");
  const label = document.createElement("strong");

  ghost.className = "studio-slide-shared-ghost lb-enter-shared";
  ghost.dataset.sharedElement = "studio-slide";
  ghost.setAttribute("aria-hidden", "true");
  number.textContent = String(index + 1);
  label.textContent = title;
  ghost.append(number, label);
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${last.left}px`,
    top: `${last.top}px`,
    width: `${last.width}px`,
    height: `${last.height}px`
  });

  document.body.append(ghost);
  animateFlip(ghost, first, last, {
    onFinish: () => window.setTimeout(() => ghost.remove(), 80)
  });
}
