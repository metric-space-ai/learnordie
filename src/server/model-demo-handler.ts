import type { ModelDemoResult } from "./model-demo";

type Session = { email: string };
type Dependencies<S extends Session> = {
  getSession(): Promise<S | null>;
  isValidCsrf(request: Request, session: S): boolean;
  createDemo(email: string): Promise<ModelDemoResult>;
};

export async function handleModelDemoPost<S extends Session>(request: Request, deps: Dependencies<S>) {
  const session = await deps.getSession();
  if (!session) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!deps.isValidCsrf(request, session)) {
    return Response.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }
  // No caller-supplied owner, template, source lecture or arbitrary content.
  // Next's Request adapter may expose an empty stream for a bodyless POST.
  // Reject bytes, not the existence of that transport stream; never parse input.
  if (request.body !== null) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.byteLength) {
          await reader.cancel();
          return Response.json({ error: "Für den Beispielsatz ist kein Anfrageinhalt vorgesehen." }, { status: 400 });
        }
      }
    } catch {
      return Response.json({ error: "Anfrage konnte nicht gelesen werden." }, { status: 400 });
    } finally { reader.releaseLock(); }
  }
  try {
    const result = await deps.createDemo(session.email);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch {
    // Database errors can contain connection details; never expose/log them here.
    return Response.json({ error: "Modell-Beispielsatz derzeit nicht verfügbar. Bitte erneut versuchen." }, { status: 503 });
  }
}
