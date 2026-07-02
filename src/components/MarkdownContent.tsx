import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

function safeHref(href: string | undefined) {
  if (!href) return "";
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? href : "";
  } catch {
    return href.startsWith("/") || href.startsWith("#") ? href : "";
  }
}

function normalizeAssistantMarkdown(content: string) {
  return content
    .replace(/\r\n?/g, "\n")
    .replace(/([^\n])\s+(#{1,4}\s+)/g, "$1\n\n$2")
    .replace(/([^\n])\s+(\d+\.\s+\*\*)/g, "$1\n$2");
}

const markdownComponents: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  h4: ({ children }) => <h5>{children}</h5>,
  a: ({ href, children }) => {
    const cleanHref = safeHref(href);
    if (!cleanHref) return <span>{children}</span>;
    return (
      <a href={cleanHref} rel="noreferrer" target={cleanHref.startsWith("#") || cleanHref.startsWith("/") ? undefined : "_blank"}>
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="markdown-table-wrap">
      <table>{children}</table>
    </div>
  )
};

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div className={`markdown-content${className ? ` ${className}` : ""}`}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {normalizeAssistantMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
