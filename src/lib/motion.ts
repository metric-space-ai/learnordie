export type FlipOptions = {
  duration?: number;
  easing?: string;
  onFinish?: () => void;
};

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function animateFlip(element: HTMLElement, first: DOMRect, last: DOMRect, options: FlipOptions = {}) {
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
