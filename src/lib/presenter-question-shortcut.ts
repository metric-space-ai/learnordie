type ShortcutEvent = Pick<KeyboardEvent,
  "code" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "repeat" | "isComposing"
>;

/** Call only after excluding editable controls and already-handled events. */
export function presenterQuestionShortcut(event: ShortcutEvent): "slide" | "transcript-only" | null {
  if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.isComposing) return null;
  return event.shiftKey ? "transcript-only" : "slide";
}
