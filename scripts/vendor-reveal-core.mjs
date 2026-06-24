#!/usr/bin/env node

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HELP_TEXT = `
Usage: node scripts/vendor-reveal-core.mjs

Imports the reduced reveal.js 6.0.1 core source snapshot into packages/slide-engine/vendor/reveal-core.

Options:
  --help, -h                        Print this usage text without importing files.
`;

const REVEAL_VERSION = "6.0.1";
const REVEAL_UPSTREAM = "https://github.com/hakimel/reveal.js";
const REVEAL_TAG_COMMIT = "52c6c8b2a9626915cfaa8a87ae47add261f282be";
const REVEAL_TARBALL = `https://registry.npmjs.org/reveal.js/-/reveal.js-${REVEAL_VERSION}.tgz`;
const VENDOR_ROOT = path.resolve("packages/slide-engine/vendor/reveal-core");
const VENDOR_SRC = path.join(VENDOR_ROOT, "src");
const MANIFEST_PATH = path.join(VENDOR_ROOT, "manifest.json");
const UPSTREAM_PATH = path.join(VENDOR_ROOT, "UPSTREAM.md");

const COPIED_PATHS = [
  "LICENSE",
  "package.json",
  "README.md",
  "css/layout.scss",
  "css/print/paper.scss",
  "css/print/pdf.scss",
  "css/reset.css",
  "css/reveal.scss",
  "js/components/playback.js",
  "js/config.ts",
  "js/controllers/autoanimate.js",
  "js/controllers/backgrounds.js",
  "js/controllers/controls.js",
  "js/controllers/focus.js",
  "js/controllers/fragments.js",
  "js/controllers/jumptoslide.js",
  "js/controllers/keyboard.js",
  "js/controllers/location.js",
  "js/controllers/notes.js",
  "js/controllers/overlay.js",
  "js/controllers/overview.js",
  "js/controllers/plugins.js",
  "js/controllers/pointer.js",
  "js/controllers/printview.js",
  "js/controllers/progress.js",
  "js/controllers/scrollview.js",
  "js/controllers/slidecontent.js",
  "js/controllers/slidenumber.js",
  "js/controllers/touch.js",
  "js/index.ts",
  "js/reveal.d.ts",
  "js/reveal.js",
  "js/utils/color.ts",
  "js/utils/constants.ts",
  "js/utils/device.ts",
  "js/utils/loader.ts",
  "js/utils/util.ts"
];

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function main() {
  if (helpRequested()) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "learnordie-reveal-core-"));
  try {
    await execFilePromise("npm", ["pack", `reveal.js@${REVEAL_VERSION}`, "--pack-destination", tempRoot], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });
    const tarballPath = path.join(tempRoot, `reveal.js-${REVEAL_VERSION}.tgz`);
    await execFilePromise("tar", ["-xzf", tarballPath, "-C", tempRoot], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });

    const packageRoot = path.join(tempRoot, "package");
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (packageJson.version !== REVEAL_VERSION) {
      throw new Error(`Expected reveal.js ${REVEAL_VERSION}, got ${packageJson.version}`);
    }

    await rm(VENDOR_SRC, { recursive: true, force: true });
    await mkdir(VENDOR_SRC, { recursive: true });

    for (const relativePath of COPIED_PATHS) {
      const source = path.join(packageRoot, relativePath);
      const target = path.join(VENDOR_SRC, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
    }

    const manifest = {
      upstream: REVEAL_UPSTREAM,
      targetRelease: REVEAL_VERSION,
      packageName: "reveal.js",
      packageTarball: REVEAL_TARBALL,
      pinnedCommit: REVEAL_TAG_COMMIT,
      copiedPaths: COPIED_PATHS,
      intentionallyExcluded: [
        "demo.html",
        "index.html",
        "dist/",
        "css/theme/",
        "css/theme/fonts/",
        "dist/plugin/",
        "external plugin examples"
      ],
      localPatches: [],
      status: "imported"
    };
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(UPSTREAM_PATH, upstreamMarkdown(manifest));
    console.log(JSON.stringify({
      ok: true,
      command: "vendor-reveal-core",
      copied: COPIED_PATHS.length,
      upstream: REVEAL_UPSTREAM,
      targetRelease: REVEAL_VERSION,
      pinnedCommit: REVEAL_TAG_COMMIT
    }, null, 2));
  }
  finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function upstreamMarkdown(manifest) {
  return `# reveal.js Upstream

The learnordie slide engine vendors a controlled, reduced source snapshot of selected reveal.js core modules.

Canonical product repository:

- https://github.com/metric-space-ai/learnordie

Upstream source:

- ${manifest.upstream}

Pinned release:

- reveal.js ${manifest.targetRelease}

Pinned upstream commit:

- ${manifest.pinnedCommit}

Imported paths:

${manifest.copiedPaths.map((item) => `- \`src/${item}\``).join("\n")}

Intentionally excluded:

${manifest.intentionallyExcluded.map((item) => `- \`${item}\``).join("\n")}

Do not treat https://github.com/metric-space-ai/learnordie-slide-engine as the source of truth. It was created during exploration and may only be used as a temporary comparison copy.
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.stdout) console.error(error.stdout);
  if (error?.stderr) console.error(error.stderr);
  process.exitCode = 1;
});
