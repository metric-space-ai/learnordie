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
    "src/lib/student-pseudonym.test.ts",
    "src/server/student-claims.test.ts"
  ],
  { stdio: "inherit", cwd: root }
);
child.on("exit", (code) => process.exit(code ?? 1));
