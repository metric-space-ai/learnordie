#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const HELP_TEXT = `
Usage: node scripts/slide-engine-vendor-check.mjs

Checks that the reduced reveal.js vendor snapshot is pinned, documented and free of excluded demo/plugin/theme paths.

Options:
  --help, -h                        Print this usage text without running checks.
`;

const VENDOR_ROOT = path.resolve("packages/slide-engine/vendor/reveal-core");
const VENDOR_SRC = path.join(VENDOR_ROOT, "src");
const MANIFEST_PATH = path.join(VENDOR_ROOT, "manifest.json");
const UPSTREAM_PATH = path.join(VENDOR_ROOT, "UPSTREAM.md");
const REQUIRED_EXCLUDED_PATHS = [
  "demo.html",
  "index.html",
  "dist",
  "css/theme"
];

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

function pass(id, message, details = {}) {
  return { id, status: "pass", message, details };
}

function fail(id, message, details = {}) {
  return { id, status: "fail", message, details };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  }
  catch {
    return false;
  }
}

async function main() {
  if (helpRequested()) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const upstream = await readFile(UPSTREAM_PATH, "utf8");
  const checks = [];

  checks.push(
    manifest.status === "imported"
      ? pass("status", "Vendor manifest is marked imported.")
      : fail("status", "Vendor manifest is not marked imported.", { status: manifest.status })
  );

  checks.push(
    typeof manifest.pinnedCommit === "string" && /^[0-9a-f]{40}$/.test(manifest.pinnedCommit)
      ? pass("pinned_commit", "Vendor manifest pins an exact upstream commit.", { pinnedCommit: manifest.pinnedCommit })
      : fail("pinned_commit", "Vendor manifest does not pin an exact upstream commit.", { pinnedCommit: manifest.pinnedCommit ?? null })
  );

  const copiedPaths = Array.isArray(manifest.copiedPaths) ? manifest.copiedPaths : [];
  const missingCopiedPaths = [];
  for (const relativePath of copiedPaths) {
    if (!await exists(path.join(VENDOR_SRC, relativePath))) missingCopiedPaths.push(relativePath);
  }
  checks.push(
    copiedPaths.length > 0 && missingCopiedPaths.length === 0
      ? pass("copied_paths", "All manifest copied paths exist.", { total: copiedPaths.length })
      : fail("copied_paths", "Manifest copied paths are missing.", { total: copiedPaths.length, missing: missingCopiedPaths })
  );

  const presentExcludedPaths = [];
  for (const relativePath of REQUIRED_EXCLUDED_PATHS) {
    if (await exists(path.join(VENDOR_SRC, relativePath))) presentExcludedPaths.push(relativePath);
  }
  checks.push(
    presentExcludedPaths.length === 0
      ? pass("excluded_paths", "Excluded demo/dist/theme paths are absent from the reduced vendor snapshot.", { excluded: REQUIRED_EXCLUDED_PATHS })
      : fail("excluded_paths", "Excluded paths are present in the reduced vendor snapshot.", { present: presentExcludedPaths })
  );

  const upstreamMissing = [
    manifest.targetRelease,
    manifest.pinnedCommit,
    "Imported paths",
    "Intentionally excluded"
  ].filter((text) => typeof text !== "string" || !upstream.includes(text));
  checks.push(
    upstreamMissing.length === 0
      ? pass("upstream_doc", "UPSTREAM.md documents release, commit, copied paths and exclusions.")
      : fail("upstream_doc", "UPSTREAM.md is missing required vendor metadata.", { missing: upstreamMissing })
  );

  const failed = checks.filter((check) => check.status === "fail");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    command: "slide-engine-vendor-check",
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  }, null, 2));

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    command: "slide-engine-vendor-check",
    checks: [
      fail("runtime", error instanceof Error ? error.message : String(error))
    ],
    summary: {
      total: 1,
      passed: 0,
      failed: 1
    }
  }, null, 2));
  process.exitCode = 1;
});
