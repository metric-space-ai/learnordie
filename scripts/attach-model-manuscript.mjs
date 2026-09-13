#!/usr/bin/env node
// Explicit, additive maintenance; never part of the normal application build.
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createOriginalModelDocument } from "@/lib/model-original-template";
import { attachLectureScript } from "./lib/attach-lecture-script.mjs";
import { savePrivateScriptBackup } from "./lib/private-wording-backup.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/attach-model-manuscript.mjs --lecture-id UUID --public-token TOKEN --owner-email OWNER [--apply --confirm-script-sha256 HASH --backup-blob maintenance/lecture-script/UNIQUE.json]\nDefault: owner-scoped, locked dry-run. Application only inside Vercel production, after ending the session; exact manuscript hash and a private read-back-verified backup required. Slides, questions, grading and lecture metadata are preserved.");
} else {
  let sql;
  try {
    const values = {};
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === "--apply" && values.apply === undefined) { values.apply = true; continue; }
      if (!["--lecture-id", "--public-token", "--owner-email", "--confirm-script-sha256", "--backup-blob"].includes(flag) || values[flag] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid arguments");
      values[flag] = args[++i];
    }
    const asset = createOriginalModelDocument("manuscript-source", Array.from({ length: 8 }, (_, i) => `source-${i}`)).assets.find(item => item.id === "model-original-companion");
    const scriptSha256 = createHash("sha256").update(asset.structuredData.text).digest("hex");
    if (!process.env.DATABASE_URL || !values["--lecture-id"] || !values["--public-token"] || !values["--owner-email"]) throw new Error("Missing configuration or exact target");
    if (values.apply && (process.env.VERCEL_ENV !== "production" || values["--confirm-script-sha256"] !== scriptSha256 || !values["--backup-blob"])) throw new Error("Production, matching script hash and private backup are required");
    sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 8, idle_timeout: 5 });
    let backupReceipt;
    const result = await attachLectureScript(sql, { lectureId: values["--lecture-id"], publicToken: values["--public-token"], ownerEmail: values["--owner-email"], asset, apply: values.apply ?? false,
      backup: async backup => { backupReceipt = await savePrivateScriptBackup(values["--backup-blob"], { ...backup, scriptSha256 }); } });
    console.log(JSON.stringify({ ...result, scriptSha256, backupReceipt }));
  } catch {
    // Database/provider errors can contain private content or credentials.
    console.error("Manuscript maintenance failed; inspect the scoped target, session state, source hash and private backup configuration.");
    process.exitCode = 1;
  } finally { await sql?.end({ timeout: 3 }); }
}
