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
