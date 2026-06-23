const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export type ReadJsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413 };

export async function readJsonBody(request: Request, maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES): Promise<ReadJsonBodyResult> {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > maxBytes) {
    return { ok: false, status: 413 };
  }

  try {
    return { ok: true, body: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
