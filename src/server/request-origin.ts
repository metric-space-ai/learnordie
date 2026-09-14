/** Match the browser's public authority, not Next's internal listen hostname.
 * Host cannot be chosen by cross-site browser JavaScript. Forwarded headers
 * are deliberately not trusted here; deployments must preserve Host.
 * Origin-less non-browser callers retain the existing authenticated API path.
 */
export function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const source = request.headers.get("origin");
  if (source === null) return true;
  try {
    const target = new URL(request.url);
    const host = request.headers.get("host");
    if (host !== null) {
      if (!host || /[\s,/@\\?#]/.test(host)) return false;
      target.host = host;
      if (target.host !== host.toLowerCase()) return false;
    }
    const origin = new URL(source);
    return ["http:", "https:"].includes(origin.protocol) &&
      source === origin.origin && origin.origin === target.origin;
  } catch { return false; }
}
