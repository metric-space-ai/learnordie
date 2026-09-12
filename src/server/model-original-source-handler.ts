import { originalModelSlides, originalModelCompanion, originalModelSourcesHtml } from "@/lib/model-original-source";
import { originalModelText } from "@/lib/model-original-template";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function handleModelOriginalSource(request: Request, getSession: () => Promise<{ email: string } | null>) {
  if (!(await getSession())) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (new URL(request.url).searchParams.get("view") === "read") {
    const notes = originalModelSlides.map((slide, i) => `<section id="slide-${i + 1}"><h2>${i + 1}. ${escape(originalModelText(slide.title))}</h2><p>${escape(originalModelText(slide.lead))}</p><pre>${escape(originalModelText(slide.notes))}</pre><p>${escape(slide.source)}</p></section>`).join("");
    const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modellbegriff · Originalnotizen und Vorlesungsunterlage</title><style>html{color-scheme:light dark;font:18px/1.6 system-ui}body{max-width:76ch;margin:auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section{padding-block:24px;border-bottom:1px solid #8886}a{color:inherit}h1{line-height:1.2}</style><main><h1>Originalnotizen und Vorlesungsunterlage</h1><p>Unveränderte Quelltexte zur importierten Originalvorlesung; eigene spätere Folienbearbeitungen verändern diese Quelle nicht.</p><p><a href="/api/lectures/model-demo/source">Vollständige Vorlesungsunterlage herunterladen</a> · <a href="#handout">Zum Begleitskript</a></p>${notes}<section><h2>Quellen und Abgrenzungen der Originalpräsentation</h2><pre>${escape(originalModelText(originalModelSourcesHtml))}</pre><p><a href="https://www.jmlr.org/papers/v3/bengio03a.html">Bengio et al. (2003)</a> · <a href="https://arxiv.org/abs/1706.03762">Vaswani et al. (2017)</a></p></section><section id="handout"><h2>Vollständiges Begleitskript (Markdown-Originaltext)</h2><pre>${escape(originalModelCompanion)}</pre></section></main></html>`;
    return new Response(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
  }
  return new Response(originalModelCompanion, { headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="Modellbegriff-Vorlesungsunterlage.md"' } });
}
