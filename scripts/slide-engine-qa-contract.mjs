#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const HELP_TEXT = `
Usage: node scripts/slide-engine-qa-contract.mjs

Checks the Slide Engine Track H QA contract in docs/slide-engine-fork-refactor-plan.md.

Options:
  --help, -h                        Print this usage text without running checks.
`;

const planPath = path.resolve("docs/slide-engine-fork-refactor-plan.md");

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

function pass(id, message, details = {}) {
  return {
    id,
    status: "pass",
    message,
    details
  };
}

function fail(id, message, details = {}) {
  return {
    id,
    status: "fail",
    message,
    details
  };
}

function checkRequiredText(plan, id, requiredTexts) {
  const missing = requiredTexts.filter((text) => !plan.includes(text));
  if (missing.length === 0) {
    return pass(id, "Required plan text is present.", {
      required: requiredTexts
    });
  }
  return fail(id, "Required plan text is missing.", {
    missing,
    required: requiredTexts
  });
}

function checkRequiredPatterns(plan, id, requiredPatterns) {
  const missing = requiredPatterns
    .filter((item) => !item.pattern.test(plan))
    .map((item) => item.label);
  if (missing.length === 0) {
    return pass(id, "Required plan patterns are present.", {
      required: requiredPatterns.map((item) => item.label)
    });
  }
  return fail(id, "Required plan patterns are missing.", {
    missing,
    required: requiredPatterns.map((item) => item.label)
  });
}

async function main() {
  if (helpRequested()) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const plan = await readFile(planPath, "utf8");
  const checks = [
    checkRequiredText(plan, "source_of_truth", [
      "## 6. SlideDocument als Source of Truth",
      "Die fachliche Wahrheit ist ein versioniertes `SlideDocument`",
      "Kein freies HTML als Hauptdatenmodell."
    ]),
    checkRequiredText(plan, "render_qa_viewport_matrix", [
      "### 9.6 Step 6: Render-QA",
      "Playwright rendert:",
      "1920 x 1080 Desktop",
      "1366 x 768 Laptop",
      "1024 x 768 Tablet",
      "834 x 1194 iPad Portrait",
      "390 x 844 Mobile"
    ]),
    checkRequiredPatterns(plan, "render_qa_browser_gates", [
      { label: "horizontal overflow gate", pattern: /keine horizontalen Overflows/ },
      { label: "heading clipping gate", pattern: /keine abgeschnittenen .?berschriften/ },
      { label: "quiz hotspot visibility gate", pattern: /keine verdeckten Quiz-Hotspots/ },
      { label: "button viewport gate", pattern: /keine Buttons au.erhalb des Viewports/ },
      { label: "formula readability gate", pattern: /keine unlesbaren Formeln/ },
      { label: "table usability gate", pattern: /Tabellen bleiben bedienbar/ },
      { label: "image load gate", pattern: /Bilder laden/ },
      { label: "console clean gate", pattern: /Console clean/ },
      { label: "standalone runtime dependency gate", pattern: /Standalone keine externen Runtime-Abh.ngigkeiten/ }
    ]),
    checkRequiredText(plan, "track_h_deliverables", [
      "### Track H: QA & Production Gates",
      "Playwright-Viewport-Matrix",
      "Overflow-Scanner",
      "Screenshot-Diffs",
      "Console-/Network-Gates",
      "Standalone-offline-Gate",
      "Migration-E2E"
    ]),
    checkRequiredText(plan, "acceptance_criteria", [
      "## 17. Akzeptanzkriterien",
      "Das Deck auf Desktop, Tablet und Mobile ohne Overflow rendert.",
      "Learn-Modus nutzt Mobile-Reflow, nicht nur Downscaling.",
      "Playwright-E2E deckt Live, Learn, Studio und Standalone ab."
    ])
  ];

  const failed = checks.filter((check) => check.status === "fail");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    command: "slide-engine-qa-contract",
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
    command: "slide-engine-qa-contract",
    checks: [
      {
        id: "slide_engine_qa_contract",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        details: {
          planPath
        }
      }
    ],
    summary: {
      total: 1,
      passed: 0,
      failed: 1
    }
  }, null, 2));
  process.exitCode = 1;
});
