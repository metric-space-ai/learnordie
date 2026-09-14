// Explicit DT-01 maintenance, never part of an ordinary application build.
import postgres from "postgres";
import { upgradeOriginalSlides } from "./lib/upgrade-original-slides.mjs";
import { savePrivateScriptBackup } from "./lib/private-wording-backup.mjs";
import { planOriginalModelUpgrade } from "@/lib/model-original-template";
import { slideDocumentToLegacySlides } from "../packages/slide-engine/src/legacy.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expectedDigest = args.find(value => value.startsWith("--digest="))?.slice(9);
const backupPath = args.find(value => value.startsWith("--backup="))?.slice(9);
if (!args.includes("--run") || process.env.VERCEL_ENV !== "production" || !process.env.DATABASE_URL
  || args.some(value => !["--run", "--apply"].includes(value) && !/^--(digest|backup)=/.test(value))
  || (apply && (!/^[a-f0-9]{64}$/.test(expectedDigest ?? "") || !backupPath))) {
  throw new Error("Use --run in production; application additionally requires --apply --digest=INSPECTED_SHA256 --backup=PRIVATE_PATH");
}
const sql = postgres(process.env.DATABASE_URL, {max:1, prepare:false, connect_timeout:8, idle_timeout:5});
let backupReceipt;
try {
  const result = await upgradeOriginalSlides(sql, {
    lectureId:"f331d389-7e6e-4b82-b144-db7764fe7084",
    publicToken:"der-modellbegriff-im-wandel-08a40b",
    ownerEmail:"michael.welsch@metric-space.ai",
    apply, expectedDigest,
    plan:planOriginalModelUpgrade,
    project:(document, rows) => slideDocumentToLegacySlides(document, rows.map(row => ({id:row.id,title:row.title,...row.content_json}))),
    backup:async value => { backupReceipt = await savePrivateScriptBackup(backupPath, value); }
  });
  console.log(JSON.stringify({maintenance:"dt01-original-slides-v2", ...result, backupReceipt}));
} catch (error) {
  const allowed = ["End the live session before upgrading slides", "Resolve source conflicts before migration", "Source changed since inspection", "Private backup failed; manuscript was not changed"];
  console.error(JSON.stringify({maintenance:"dt01-original-slides-v2",status:"failed",message:allowed.includes(error?.message) ? error.message : "Maintenance refused; no credentials or private content logged."}));
  process.exitCode = 1;
} finally { await sql.end({timeout:3}); }
