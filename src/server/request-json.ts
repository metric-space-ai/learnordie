const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export type ReadJsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413 };

export async function readJsonBody(request: Request, maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES): Promise<ReadJsonBodyResult> {
  if (Number(request.headers.get("content-length")) > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let rawBody = "";
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); return { ok: false, status: 413 }; }
      rawBody += decoder.decode(part.value, { stream: true });
    }
    rawBody += decoder.decode();
    return { ok: true, body: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false, status: 400 };
  } finally { reader.releaseLock(); }
}
