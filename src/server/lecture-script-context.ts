import type { Lecture } from "@/lib/types";

export type ScriptBlock = { source: string; content: string };

/** Read only the source documents attached to this already-authorized lecture.
 * Imported decks can carry their complete manuscript here without asset_chunks.
 * Never substitute a globally bundled manuscript based on a matching title.
 */
export function attachedScriptBlocks(lecture: Pick<Lecture, "slideDocument">): ScriptBlock[] {
  return (lecture.slideDocument?.assets ?? []).flatMap((asset) => {
    if (asset.kind !== "sourceDocument") return [];
    const data = asset.structuredData;
    if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string") return [];
    if (!("format" in data) || !["text/markdown", "text/plain"].includes(String(data.format))) return [];
    return [{ source: asset.title || asset.id, content: data.text }];
  });
}

/** Text-only selection: no embeddings, cross-lecture lookup or provider call. */
export function packScriptContext(blocks: ScriptBlock[], focusText = "", budget = 14_000): string {
  const unique = new Set<string>();
  const paragraphs = blocks.flatMap(({ source, content }) => content.split(/\n\s*\n/u).flatMap((paragraph) => {
    // Bound a single oversized paragraph so it cannot disappear from selection.
    const chunks = paragraph.trim().match(/[\s\S]{1,1200}(?:\s|$)|[\s\S]{1,1200}/gu) ?? [];
    return chunks.map((text) => ({ source: source.slice(0, 200), content: text.trim() }));
  })).filter(({ content }) => {
    if (!content || unique.has(content)) return false;
    unique.add(content);
    return true;
  });
  const terms = [...new Set(focusText.toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]{4,}/gu) ?? [])];
  const ranked = paragraphs.map((block, index) => ({
    ...block, index,
    score: terms.reduce((score, term) => score + (block.content.toLocaleLowerCase("de-DE").includes(term) ? 1 : 0), 0),
    length: block.source.length + block.content.length + 3
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [];
  let used = 0;
  for (const block of ranked) {
    if (used + block.length > budget) continue;
    selected.push(block);
    used += block.length;
  }
  return selected.sort((a, b) => a.index - b.index).map(({ source, content }) => `${source}: ${content}`).join("\n");
}
