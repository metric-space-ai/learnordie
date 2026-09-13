#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
  console.log("Usage: node scripts/run-unit-identity.mjs\nRuns identity, editor, model, provider and export regression tests with at most two workers.");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    "--import",
    path.join(root, "scripts/alias-register.mjs"),
    "--test",
    "--test-concurrency=2",
    "src/lib/student-pseudonym.test.ts",
    "src/lib/canvas-sync.test.ts",
    "src/lib/participation-url.test.ts",
    "src/lib/presenter-question-shortcut.test.ts",
    "src/lib/learn-settings.test.ts",
    "tests/unit/transcript-recording-status.test.mjs",
    "scripts/lib/purge-session-transcripts.test.mjs",
    "scripts/lib/upgrade-original-slides.test.mjs",
    "src/components/theme/theme-store.test.mjs",
    "src/server/model-demo.test.ts",
    "src/lib/model-original-template.test.ts",
    "src/lib/model-question-bank.test.ts",
    "tests/model-question-bank-standalone.test.ts",
    "tests/modell-playback.test.ts",
    "src/server/route-params.test.ts",
    "src/server/student-claims.test.ts",
    "src/server/test-accounts.test.ts",
    "src/server/request-json.test.ts",
    "src/server/request-origin.test.ts",
    "src/server/providers/ai.test.ts",
    "src/server/question-generation-student.test.ts",
    "src/server/student-exam-draft-state.test.ts",
    "src/server/providers/minimax-media.test.ts",
    "tests/unit/deploy-readiness-minimax.test.mjs",
    "tests/unit/question-wording-plan.test.mjs",
    "packages/slide-engine/src/excalidraw/scene.test.ts",
    "packages/slide-engine/src/scenes/modell-theme.test.ts",
    "packages/slide-engine/src/scenes/oscillator-physics.test.ts",
    "tests/unit/excalidraw-runtime.test.mjs",
    "tests/unit/standalone-native-export.test.ts"
  ],
  { stdio: "inherit", cwd: root }
);
child.on("exit", (code) => process.exit(code ?? 1));
