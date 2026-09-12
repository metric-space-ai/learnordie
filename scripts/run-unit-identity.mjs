#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
    "src/server/student-claims.test.ts",
    "src/server/test-accounts.test.ts",
    "src/server/request-json.test.ts",
    "packages/slide-engine/src/excalidraw/scene.test.ts",
    "tests/unit/excalidraw-runtime.test.mjs",
    "tests/unit/standalone-native-export.test.ts"
  ],
  { stdio: "inherit", cwd: root }
);
child.on("exit", (code) => process.exit(code ?? 1));
