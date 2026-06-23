#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const scriptsDir = path.resolve("scripts");
const HELP_TEXT = `
Usage: npm run scripts:check

Checks every operational .mjs script under scripts/ with "node --check", verifies side-effect-free help and prints JSON.

Options:
  --help, -h                        Print this usage text without running checks.
`;

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

function runNodeCheck(filePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", filePath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        error: error.message,
        stdout,
        stderr
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr
      });
    });
  });
}

function runHelpCommand(filePath, flag) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [filePath, flag], {
      cwd: process.cwd(),
      env: cleanHelpEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        error: error.message,
        stdout,
        stderr
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr
      });
    });
  });
}

function cleanHelpEnv() {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}

async function runHelpCheck(filePath) {
  const longHelp = await runHelpCommand(filePath, "--help");
  const shortHelp = await runHelpCommand(filePath, "-h");
  const issues = [];
  if (!longHelp.ok) issues.push(`--help exited with ${longHelp.code ?? "error"}`);
  if (!shortHelp.ok) issues.push(`-h exited with ${shortHelp.code ?? "error"}`);
  if ((longHelp.stderr ?? "").trim()) issues.push("--help wrote to stderr");
  if ((shortHelp.stderr ?? "").trim()) issues.push("-h wrote to stderr");
  if (!(longHelp.stdout ?? "").trim()) issues.push("--help produced no output");
  if (longHelp.stdout !== shortHelp.stdout) issues.push("--help and -h output differ");
  if ((longHelp.stdout ?? "").includes("\"checks\"") || (longHelp.stdout ?? "").includes("\"ok\"")) {
    issues.push("--help output looks like machine-readable check JSON");
  }

  return {
    ok: issues.length === 0,
    issues,
    stdout: longHelp.stdout ?? "",
    stderr: `${longHelp.stderr ?? ""}\n${shortHelp.stderr ?? ""}`.trim(),
    error: [longHelp.error, shortHelp.error].filter(Boolean).join("; ")
  };
}

function excerpt(stdout, stderr) {
  const text = `${stdout}\n${stderr}`.trim();
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

async function main() {
  const entries = await readdir(scriptsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => path.join(scriptsDir, entry.name))
    .sort();

  const checks = [];
  for (const filePath of files) {
    const syntax = await runNodeCheck(filePath);
    const help = await runHelpCheck(filePath);
    const ok = syntax.ok && help.ok;
    checks.push({
      id: path.basename(filePath),
      status: ok ? "pass" : "fail",
      message: ok ? "Script syntax and help contract are valid." : "Script syntax or help contract failed.",
      details: ok ? {
        helpFirstLine: (help.stdout ?? "").trim().split("\n")[0] ?? ""
      } : {
        syntax: syntax.ok ? "pass" : "fail",
        help: help.ok ? "pass" : "fail",
        exitCode: syntax.code ?? null,
        helpIssues: help.issues,
        output: excerpt(
          `${syntax.stdout ?? ""}\n${help.stdout ?? ""}`,
          `${syntax.stderr ?? ""}\n${syntax.error ?? ""}\n${help.stderr ?? ""}\n${help.error ?? ""}`
        )
      }
    });
  }

  const failed = checks.filter((check) => check.status === "fail");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    command: "script-syntax-check",
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
    command: "script-syntax-check",
    checks: [
      {
        id: "script_syntax_check",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        details: {}
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
