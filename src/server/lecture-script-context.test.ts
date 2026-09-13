import assert from "node:assert/strict";
import test from "node:test";
import type { Lecture } from "@/lib/types";
import { attachedScriptBlocks, packScriptContext } from "./lecture-script-context.ts";

const lecture = (assets: unknown[]) => ({ slideDocument: { assets } }) as Pick<Lecture, "slideDocument">;
test("attached manuscript participates even without extracted database chunks", () => {
  const blocks = attachedScriptBlocks(lecture([{ id: "script", kind: "sourceDocument", title: "Vorlesungsunterlage", structuredData: { format: "text/markdown", text: "# Naturgesetz\n\nDie statische Verlängerung beträgt mg/k." } }]));
  assert.match(packScriptContext(blocks, "statische Verlängerung"), /mg\/k/);
});
test("unrelated lectures and executable source metadata never receive a global fallback", () => {
  assert.deepEqual(attachedScriptBlocks({}), []);
  assert.deepEqual(attachedScriptBlocks(lecture([
    { id: "html", kind: "sourceDocument", structuredData: { format: "text/html", text: "<script>bad()</script>" } },
    { id: "image", kind: "image", structuredData: { format: "text/plain", text: "Not a manuscript" } },
    { id: "raw", kind: "sourceDocument", structuredData: { slides: [] } }
  ])), []);
});
test("latest topic selects a late manuscript passage within a strict prompt budget", () => {
  const blocks = Array.from({ length: 40 }, (_, index) => ({ source: "Skript", content: `Absatz ${index}: ${"Allgemeine Grundlagen. ".repeat(40)}` }));
  blocks.push({ source: "Skript", content: "Bei einer vertikalen Feder ist die statische Verlängerung mg/k." });
  const packed = packScriptContext(blocks, "vertikale Feder statische Verlängerung", 3000);
  assert.ok(packed.length <= 3000);
  assert.match(packed, /statische Verlängerung mg\/k/);
});
test("oversized paragraphs remain usable and duplicated extracted text is packed once", () => {
  const content = "Federsteifigkeit und Energie. ".repeat(300);
  const packed = packScriptContext([{ source: "Skript", content }, { source: "Kopie", content }]);
  assert.ok(packed.length > 0 && packed.length <= 14_000);
  assert.doesNotMatch(packed, /Kopie:/);
});
