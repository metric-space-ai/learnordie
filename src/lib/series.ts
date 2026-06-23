// Client-safe, deterministic mapping from a series title to a stable series id.
// In local mode this slug IS the series id; the server `slugify` delegates to this
// so the client and server always agree on the id for a given title.

export function seriesIdFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46);

  return slug || "vorlesung";
}
