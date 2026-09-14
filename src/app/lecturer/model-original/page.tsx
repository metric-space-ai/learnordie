import { Children, isValidElement, type ReactNode } from "react";
import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { getLecturerSession } from "@/server/auth";
import { originalModelCompanion, originalModelSlides, originalModelSourcesHtml } from "@/lib/model-original-source";
import { originalModelText } from "@/lib/model-original-template";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import styles from "./reader.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modellbegriff · Originalnotizen und Begleitskript" };

function plainText(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child)
    ? plainText(child.props.children) : typeof child === "string" || typeof child === "number" ? String(child) : "").join("");
}

function headingId(children: ReactNode) {
  return plainText(children).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
}

export default async function ModelOriginalReaderPage() {
  if (!(await getLecturerSession())) redirect("/lecturer/login");
  return <main className={styles.reader}>
    <nav aria-label="Vorlesungsunterlage">
      <a href="/lecturer">← Zum Studio</a>
      <a href="/api/lectures/model-demo/source" download>Markdown-Original herunterladen</a>
      <a href="#handout">Zum Begleitskript</a>
      <ThemeToggle />
    </nav>
    <h1>Originalnotizen und Vorlesungsunterlage</h1>
    <p className={styles.intro}>Der vollständige Originalvortrag mit acht Folien und Begleitskript. Eigene Folienbearbeitungen verändern diese Quelle nicht.</p>
    <details className={styles.notes}>
      <summary>Originalnotizen der acht Folien</summary>
      {originalModelSlides.map((slide, i) => <section key={slide.scene} id={`slide-${i + 1}`}>
        <h2>{i + 1}. {originalModelText(slide.title)}</h2>
        <p>{originalModelText(slide.lead)}</p>
        <p className={styles.preserved}>{originalModelText(slide.notes)}</p>
        <p>{slide.source}</p>
      </section>)}
      <section><h2>Quellen der Originalpräsentation</h2><p className={styles.preserved}>{originalModelText(originalModelSourcesHtml)}</p></section>
    </details>
    <article id="handout" aria-label="Vollständiges Begleitskript" className={styles.handout}>
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, output: "mathml", strict: "error", maxSize: 20, maxExpand: 1000 }]]}
        components={{
          h1: ({ children }) => <h2 id={headingId(children)}>{children}</h2>,
          h2: ({ children }) => <h2 id={headingId(children)}>{children}</h2>,
          h3: ({ children }) => <h3 id={headingId(children)}>{children}</h3>,
          h4: ({ children }) => <h4 id={headingId(children)}>{children}</h4>,
          table: ({ children }) => <div className={styles.tableScroll}><table>{children}</table></div>
        }}>
        {originalModelCompanion}
      </ReactMarkdown>
    </article>
  </main>;
}
