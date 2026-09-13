import { originalModelCompanion } from "@/lib/model-original-source";

export async function handleModelOriginalSource(request: Request, getSession: () => Promise<{ email: string } | null>) {
  if (!(await getSession())) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (new URL(request.url).searchParams.get("view") === "read") {
    return new Response(null, { status: 303, headers: { ...headers, Location: "/lecturer/model-original" } });
  }
  return new Response(originalModelCompanion, { headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="Modellbegriff-Vorlesungsunterlage.md"' } });
}
