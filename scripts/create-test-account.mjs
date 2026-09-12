#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/create-test-account.mjs <absolute-output-directory> [qa-live@learnordie.test] [hours: 1-168]");
  process.exit(0);
}
const [directory, email = "qa-live@learnordie.test", rawHours = "48"] = process.argv.slice(2);
const hours = Number(rawHours);
if (!directory || !path.isAbsolute(directory) || !/^[a-z0-9._+-]+@learnordie\.test$/.test(email) || !Number.isInteger(hours) || hours < 1 || hours > 168) {
  console.error("Provide an absolute private directory, an @learnordie.test address, and a lifetime of 1–168 hours. Use --help.");
  process.exit(1);
}
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(path.join(directory, "test-accounts.env-value.json"), JSON.stringify([{ email, passwordHash, expiresAt }]), { mode: 0o600, flag: "wx" });
await writeFile(path.join(directory, "credentials.json"), JSON.stringify({ email, password, expiresAt }, null, 2), { mode: 0o600, flag: "wx" });
console.log(`Private configuration and credentials created in ${directory}. Expires ${expiresAt}. No passwords printed.`);
