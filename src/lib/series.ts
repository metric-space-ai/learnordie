// Titles are display labels, never globally unique identifiers. Only legacy
// local records lack an explicit series ID; PostgreSQL always supplies its UUID.
export function seriesIdForLecture(lecture: { seriesId?: string; seriesTitle: string }): string {
  return lecture.seriesId ?? seriesIdFromTitle(lecture.seriesTitle);
}

/** Legacy/local slug; do not derive an ID from a Postgres lecture title. */
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
