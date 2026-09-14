// Explicit DT-01 maintenance, never part of an ordinary application build.
import postgres from "postgres";
import { upgradeOriginalSlides } from "./lib/upgrade-original-slides.mjs";
import { savePrivateScriptBackup } from "./lib/private-wording-backup.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/upgrade-dt01-slides.mjs --run [--apply --digest=INSPECTED_SHA256 --backup=maintenance/lecture-script/UNIQUE.json]\nProduction-only DT-01 layout maintenance. Default is a locked dry run; application requires a verified private backup and unchanged inspected digest. Preserves all question and slide identities.");
  process.exit(0);
}
const apply = args.includes("--apply");
const expectedDigest = args.find(value => value.startsWith("--digest="))?.slice(9) ?? process.env.DT01_LAYOUT_DIGEST;
const backupPath = args.find(value => value.startsWith("--backup="))?.slice(9) ?? process.env.DT01_LAYOUT_BACKUP;
if (!args.includes("--run") || process.env.VERCEL_ENV !== "production" || !process.env.DATABASE_URL
  || args.some(value => !["--run", "--apply"].includes(value) && !/^--(digest|backup)=/.test(value))
  || (apply && (!/^[a-f0-9]{64}$/.test(expectedDigest ?? "") || !backupPath))) {
  throw new Error("Use --run in production; application additionally requires --apply --digest=INSPECTED_SHA256 --backup=PRIVATE_PATH");
}
const sql = postgres(process.env.DATABASE_URL, {max:1, prepare:false, connect_timeout:8, idle_timeout:5});
let backupReceipt;
try {
  const { planOriginalModelUpgrade } = await import("@/lib/model-original-template");
  const { slideDocumentToLegacySlides } = await import("../packages/slide-engine/src/legacy.ts");
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
