#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const HELP_TEXT = `
Usage: node scripts/slide-engine-qa-contract.mjs

Checks the Slide Engine QA contract in executable source files.

Options:
  --help, -h                        Print this usage text without running checks.
`;

const qaSpecPath = path.resolve("tests/e2e/slide-engine-qa.spec.ts");
const enginePath = path.resolve("packages/slide-engine/src/index.ts");
const schemaPath = path.resolve("packages/slide-engine/src/schema.ts");
const rendererPath = path.resolve("packages/slide-engine/src/components/SlideRenderer.tsx");

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

  const [qaSpec, engineIndex, schema, renderer] = await Promise.all([
    readFile(qaSpecPath, "utf8"),
    readFile(enginePath, "utf8"),
    readFile(schemaPath, "utf8"),
    readFile(rendererPath, "utf8")
  ]);
  const engine = [engineIndex, schema, renderer].join("\n");
  const checks = [
    checkRequiredText(engine, "source_of_truth", [
      "SlideDocument",
      "SlideBlock",
      "validateSlideDocument",
      "SlideRenderer",
      "renderStandaloneSlideDocumentHtml"
    ]),
    checkRequiredText(qaSpec, "render_qa_viewport_matrix", [
      "1920",
      "1080",
      "1366",
      "768",
      "1024",
      "834",
      "1194",
      "390",
      "844"
    ]),
    checkRequiredPatterns(qaSpec, "render_qa_browser_gates", [
      { label: "horizontal overflow gate", pattern: /documentOverflowX/ },
      { label: "heading clipping gate", pattern: /heading-clipped/ },
      { label: "quiz hotspot visibility gate", pattern: /hotspot/ },
      { label: "button viewport gate", pattern: /interactive-overflow/ },
      { label: "formula readability gate", pattern: /formula/ },
      { label: "table usability gate", pattern: /table/ },
      { label: "image load gate", pattern: /image/ },
      { label: "console clean gate", pattern: /pageerror|requestfailed|console/i },
      { label: "standalone runtime dependency gate", pattern: /standalone|external/i }
    ]),
    checkRequiredText(qaSpec, "track_h_deliverables", [
      "inspectSlidePage",
      "test.describe",
      "page.goto",
      "page.screenshot",
      "requestfailed"
    ]),
    checkRequiredText(qaSpec, "acceptance_criteria", [
      "Desktop",
      "Tablet",
      "Mobile",
      "overflow",
      "standalone"
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
