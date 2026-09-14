import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
  console.log("Usage: node --import ./scripts/alias-register.mjs <script>\nRegisters the source-alias ESM loader.");
} else {
  register(new URL("./alias-loader.mjs", import.meta.url));
}
