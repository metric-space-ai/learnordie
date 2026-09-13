/** One public classroom URL for the studio, projected link, clipboard and QR. */
export function participationUrl(path: string, configuredAppUrl: string | undefined, browserOrigin = ""): string {
  const publicPath = path.replace(/^\/join\//, "/l/");
  for (const candidate of [configuredAppUrl, browserOrigin]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") return `${url.origin}${publicPath}`;
    } catch { /* Fall back to the browser origin for local development. */ }
  }
  return publicPath;
}
