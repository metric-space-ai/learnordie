#!/usr/bin/env node
// Reproducible, narrowly pinned transformation of the supplied vendor artifact.
// The readable substitutions are the source of truth; never hand-edit its
// multi-megabyte minified lines or silently accept a different upstream build.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const help = process.argv.includes("--help") || process.argv.includes("-h");
if (help) {
  console.log("Usage: node scripts/patch-excalidraw-image-import.mjs [--write]\nChecks the pinned image-error patch. --write applies it and refreshes fork provenance.");
  process.exit(0);
}
const root = new URL("../public/vendor/excalidraw/", import.meta.url);
const bundlePath = fileURLToPath(new URL("excalidraw.mjs", root));
const provenancePath = fileURLToPath(new URL("PROVENANCE.json", root));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const originalHash = "6705cba17500e9578248296fbdf2db3b23f621b6257756c336fa1313dd6528ad";
const modifications = [
  ["this.setImagePreviewCursor(U||d)", "await this.setImagePreviewCursor(U||d)"],
  ['catch(m){throw m.cause==="UNSUPPORTED"?new Error(vA("errors.unsupportedFileType")):m}let w=await Qoe(p);',
    'catch(m){throw new Error(vA(m.cause==="UNSUPPORTED"?"errors.unsupportedFileType":"errors.imageInsertError"))}let w=await Qoe(p);']
];
let source = readFileSync(bundlePath, "utf8");
const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
const alreadyPatched = modifications.every(([, after]) => source.split(after).length === 2);
if (!alreadyPatched) {
  if (sha(source) !== originalHash) throw new Error("Unexpected Excalidraw input hash; review the upstream changes before updating this patch.");
  for (const [before, after] of modifications) {
    if (source.split(before).length !== 2) throw new Error("Image patch anchor is missing or ambiguous.");
    source = source.replace(before, after);
  }
  if (!process.argv.includes("--write")) throw new Error("Vendor image patch missing. Run with --write after reviewing this transformation.");
}
const expectedHash = sha(source);
if (process.argv.includes("--write")) {
  writeFileSync(bundlePath, source);
  provenance.forkPayload["excalidraw.mjs"] = expectedHash;
  provenance.forkPayload["NOTICE.md"] = sha(readFileSync(new URL("NOTICE.md", root)));
  const note = "Await image cursor decoding and report corrupt raster files through the native localized error dialog (scripts/patch-excalidraw-image-import.mjs)";
  if (!provenance.modifications.includes(note)) provenance.modifications.push(note);
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
} else if (provenance.forkPayload["excalidraw.mjs"] !== expectedHash) {
  throw new Error("Patched Excalidraw hash does not match fork provenance.");
}
console.log(JSON.stringify({ ok: true, sha256: expectedHash, alreadyPatched }));
