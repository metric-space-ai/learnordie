import { createHash } from "node:crypto";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Refuse application unless a non-overwritten private backup was read back intact. */
export async function savePrivateWordingBackup(pathname, backup, dependencies = {}) {
  if (!/^maintenance\/question-wording\/[a-zA-Z0-9_-]+\.json$/.test(pathname)) throw new Error("Invalid private backup path");
  const sdk = dependencies.sdk ?? await import("@vercel/blob");
  const bytes = Buffer.from(JSON.stringify(backup));
  if (bytes.length > 5_000_000) throw new Error("Private backup is too large");
  // Must finish before the maintenance transaction's idle timeout. Failure
  // leaves the question bank unchanged and retains any backup already uploaded.
  const abortSignal = AbortSignal.timeout(10_000);
  try {
    const saved = await sdk.put(pathname, bytes, {
      access: "private", allowOverwrite: false, addRandomSuffix: false,
      contentType: "application/json", abortSignal
    });
    const url = new URL(saved.url);
    if (saved.pathname !== pathname || url.protocol !== "https:" || !url.hostname.endsWith(".private.blob.vercel-storage.com")) throw new Error("Unexpected private storage result");
    const stored = await sdk.get(pathname, { access: "private", useCache: false, abortSignal });
    if (!stored || stored.statusCode !== 200) throw new Error("Private backup could not be read back");
    const restored = Buffer.from(await new Response(stored.stream).arrayBuffer());
    if (restored.length !== bytes.length || digest(restored) !== digest(bytes)) throw new Error("Private backup verification failed");
    const anonymous = await (dependencies.fetch ?? fetch)(url, { redirect: "manual", signal: abortSignal });
    await anonymous.body?.cancel();
    if (![401, 403, 404].includes(anonymous.status)) throw new Error("Private backup anonymous access check failed");
    return { provider: "vercel-blob", access: "private", pathname, sha256: digest(bytes), bytes: bytes.length, readBackVerified: true };
  } catch {
    // Provider errors can embed credentials or private payloads; never print them.
    throw new Error("Private backup failed; question bank was not changed");
  }
}
