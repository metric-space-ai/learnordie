#!/usr/bin/env node
import { open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { applyQuestionWording } from "./lib/apply-question-wording.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/apply-question-wording.mjs --plan PRIVATE.json --owner-email OWNER --public-token TOKEN [--apply --confirm-sha256 FILE_SHA256 --backup DURABLE_NEW_FILE.json]\nUses DATABASE_URL; default is a locked, owner-scoped dry-run. Application requires the exact file hash and an exclusive, durable backup. End the live session first. No authentication/provider bypass is provided.");
} else {
  let sql;
  try {
    const values = {};
    for (let i = 0; i < args.length; i += 1) {
      const flag = args[i];
      if (flag === "--apply" && values.apply === undefined) { values.apply = true; continue; }
      if (!["--plan", "--owner-email", "--public-token", "--confirm-sha256", "--backup"].includes(flag) || values[flag] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid arguments; use --help");
      values[flag] = args[++i];
    }
    if (!values["--plan"] || !values["--owner-email"] || !values["--public-token"]) throw new Error("Plan, owner email and public token are required");
    const content = await readFile(values["--plan"]);
    if (content.length > 5_000_000) throw new Error("Plan too large");
    const fileSha256 = createHash("sha256").update(content).digest("hex");
    if (values.apply && (values["--confirm-sha256"] !== fileSha256 || !values["--backup"])) throw new Error("Application requires matching file SHA256 and a new backup path");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    let backupPath;
    if (values.apply) {
      const requested = path.resolve(values["--backup"]);
      backupPath = path.join(await realpath(path.dirname(requested)), path.basename(requested));
      if (["/Volumes/tmp", "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"].some((prefix) => backupPath === prefix || backupPath.startsWith(`${prefix}/`))) throw new Error("Use a durable backup directory, not temporary storage");
    }
    sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 8, idle_timeout: 5 });
    const result = await applyQuestionWording(sql, JSON.parse(content), {
      apply: values.apply ?? false, ownerEmail: values["--owner-email"], publicToken: values["--public-token"],
      backup: async (backup) => {
        const handle = await open(backupPath, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify({ ...backup, fileSha256 }, null, 2)); await handle.sync(); }
        finally { await handle.close(); }
      },
    });
    console.log(JSON.stringify({ ...result, fileSha256, ...(result.status === "applied" ? { backupPath } : {}) }));
  } catch (error) {
    // Database diagnostics may contain query text or connection data. Only our
    // deliberate maintenance errors are user-visible; provider errors use a code.
    console.error(JSON.stringify({ status: "failed", error: error?.code ? `Database/file operation failed (${error.code})` : error instanceof SyntaxError ? "Invalid plan JSON" : error.message }));
    process.exitCode = 1;
  } finally { await sql?.end({ timeout: 3 }); }
}
