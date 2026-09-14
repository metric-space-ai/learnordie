import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
  console.log("Usage: node --import ./scripts/alias-register.mjs <script>\nInternal ESM resolver for source aliases; not a standalone test runner.");
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let url = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    if (!url.endsWith(".ts") && !url.endsWith(".js")) url += ".ts";
    return nextResolve(url, context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return nextResolve(`${specifier}.ts`, context);
    }
  }
  return nextResolve(specifier, context);
}
