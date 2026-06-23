import dns from "node:dns/promises";
import net from "node:net";
import type { Lecture, LectureMaterial } from "@/lib/types";
import { getEmbeddingProvider } from "@/server/providers/embeddings";
import { isPreviewOrProductionDeployment } from "@/server/runtime-config";

export type MaterialChunk = {
  sourceRef: string;
  content: string;
  embedding: number[];
};

export type ProcessedMaterial = {
  preview: string;
  chunks: MaterialChunk[];
  sourceRefs: string[];
  warnings: string[];
};

const MAX_CHUNK_CHARS = 520;
const MAX_URL_TEXT_CHARS = 12000;
const MAX_URL_REDIRECTS = 3;
const URL_FETCH_HEADERS = {
  accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8"
};

function cleanText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactPreview(value: string) {
  const compact = cleanText(value).replace(/\s+/g, " ");
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function uploadExtractedSection(value: string) {
  const marker = "Extrahierter Text:";
  const index = value.indexOf(marker);
  if (index < 0) return value;
  return cleanText(value.slice(index + marker.length));
}

function extractionWarnings(value: string) {
  const warnings: string[] = [];
  if (/Keine verwertbaren Textinhalte gefunden/i.test(value)) {
    warnings.push("Keine verwertbaren Textinhalte gefunden. OCR oder manuelle Quellenpflege erforderlich.");
  }
  if (/OCR oder visuelle Analyse erforderlich/i.test(value)) {
    warnings.push("Bildbasierte Inhalte erkannt. Nicht getaggte Bildinhalte benötigen OCR oder visuelle Analyse.");
  }
  if (/Abruf blockiert:\s*Nur (?:oe|ö)ffentliche HTTP\(S\)-Quellen werden automatisch extrahiert\./i.test(value)) {
    warnings.push("URL-Abruf blockiert. Nur öffentliche HTTP(S)-Quellen werden automatisch extrahiert.");
  }
  return [...new Set(warnings)];
}

function textWithoutExtractionWarnings(value: string) {
  return cleanText(value
    .replace(/Keine verwertbaren Textinhalte gefunden\.[\s\S]*?Materialquelle gespeichert\./gi, " ")
    .replace(/Bildbasierte PDF-Inhalte erkannt:\s*\d+\s*eingebettete Bilder\.\s*F(?:ue|ü)r nicht getaggte Bildinhalte ist OCR oder visuelle Analyse erforderlich\./gi, " ")
    .replace(/Bildbasierte PPTX-Inhalte erkannt:.*?F(?:ue|ü)r nicht getaggte Bildinhalte ist OCR oder visuelle Analyse erforderlich\./gi, " ")
    .replace(/^Visuelle Struktur:.*$/gim, " ")
    .replace(/^Bildposition:.*$/gim, " ")
    .replace(/Abruf blockiert:\s*Nur (?:oe|ö)ffentliche HTTP\(S\)-Quellen werden automatisch extrahiert\./gi, " ")
    .replace(/^Originaldatei:.*$/gim, " ")
    .replace(/^Typ:.*$/gim, " ")
    .replace(/^Groesse:.*$/gim, " ")
    .replace(/^URL-Quelle:.*$/gim, " "));
}

function hasUsableContent(value: string) {
  const candidate = textWithoutExtractionWarnings(value);
  const words = candidate.match(/[A-Za-zÄÖÜäöüß0-9]{3,}/g) ?? [];
  return words.length >= 3;
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function ipv4Octets(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isBlockedIpv4(address: string) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second, third] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isBlockedIpv6(address: string) {
  const lower = normalizeHostname(address);
  const mappedIpv4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return true;

  const firstSegment = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstSegment)) return false;
  return (
    (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
    (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
    (firstSegment >= 0xff00 && firstSegment <= 0xffff)
  );
}

function isBlockedIpAddress(address: string) {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return false;
}

function isBlockedLocalHost(hostname: string) {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  return isBlockedIpAddress(lower);
}

async function resolvesToBlockedLocalHost(hostname: string) {
  try {
    const addresses = await dns.lookup(normalizeHostname(hostname), { all: true, verbatim: true });
    return addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address));
  } catch {
    return true;
  }
}

async function canFetchUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (process.env.LEARNBUDDY_ALLOW_LOCAL_URL_FETCH === "1" && !isPreviewOrProductionDeployment()) return true;
  if (isBlockedLocalHost(url.hostname)) return false;
  return !(await resolvesToBlockedLocalHost(url.hostname));
}

function blockedUrlText(rawUrl: string) {
  return [
    `URL-Quelle: ${rawUrl}`,
    "Abruf blockiert: Nur öffentliche HTTP(S)-Quellen werden automatisch extrahiert."
  ].join("\n");
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchPublicUrl(url: URL, signal: AbortSignal) {
  let currentUrl = url;

  for (let redirects = 0; redirects <= MAX_URL_REDIRECTS; redirects += 1) {
    if (!(await canFetchUrl(currentUrl))) {
      return { blocked: true as const };
    }

    const response = await fetch(currentUrl, {
      headers: URL_FETCH_HEADERS,
      redirect: "manual",
      signal
    });

    if (!isRedirectStatus(response.status)) {
      return { blocked: false as const, response };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { blocked: false as const, response };
    }

    if (redirects === MAX_URL_REDIRECTS) {
      throw new Error("URL extraction redirect limit exceeded.");
    }

    currentUrl = new URL(location, currentUrl);
  }

  throw new Error("URL extraction redirect limit exceeded.");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(value: string) {
  const withoutIgnoredBlocks = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = withoutIgnoredBlocks
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "));
}

async function fetchUrlText(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }

  if (!(await canFetchUrl(url))) {
    return blockedUrlText(rawUrl);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetchPublicUrl(url, controller.signal);
    if (result.blocked) return blockedUrlText(rawUrl);
    const response = result.response;
    if (!response.ok) throw new Error(`URL extraction failed: ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    const raw = (await response.text()).slice(0, MAX_URL_TEXT_CHARS);
    const extracted = contentType.includes("html") || /<html|<body|<p\b|<article\b/i.test(raw)
      ? htmlToText(raw)
      : raw;
    return cleanText([`URL-Quelle: ${rawUrl}`, extracted].join("\n"));
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackText(lecture: Lecture, material: LectureMaterial) {
  if (material.source === "url") {
    return [
      `URL-Quelle: ${material.originalName}`,
      `Vorlesung: ${lecture.title}`,
      "Die Quelle wurde als externer Kontext für die Fragenpipeline erfasst."
    ].join("\n");
  }

  if (material.source === "notes") {
    return `Planungsnotiz zu ${lecture.title}: ${material.originalName}`;
  }

  return [
    `Datei: ${material.originalName}`,
    `Materialtyp: ${material.kind}`,
    `Vorlesung: ${lecture.title}`,
    "Die Datei wurde vorgemerkt. Vollständige PPTX/PDF-Extraktion folgt in der nächsten Pipeline-Stufe."
  ].join("\n");
}

function chunkText(text: string) {
  const paragraphs = cleanText(text)
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÄÖÜ])/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (`${current}\n${paragraph}`.length <= MAX_CHUNK_CHARS) {
      current = `${current}\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = paragraph;
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [cleanText(text)];
}

export async function processMaterialContent(input: {
  lecture: Lecture;
  material: LectureMaterial;
  storedText?: string;
}): Promise<ProcessedMaterial> {
  const storedText = cleanText(input.storedText ?? "");
  const fetchedUrlText = input.material.source === "url"
    ? await fetchUrlText(storedText || input.material.originalName)
    : "";
  const rawExtracted = cleanText(fetchedUrlText || storedText);
  const extracted = input.material.source === "upload"
    ? uploadExtractedSection(rawExtracted)
    : rawExtracted;
  const warnings = extractionWarnings(extracted);

  if (!hasUsableContent(extracted)) {
    const preview = compactPreview(extracted || fallbackText(input.lecture, input.material));
    return {
      preview,
      chunks: [],
      sourceRefs: [],
      warnings: warnings.length > 0
        ? warnings
        : ["Keine verwertbaren Fachinhalte extrahiert. Quelle manuell nachpflegen oder OCR/visuelle Analyse nutzen."]
    };
  }

  const embeddingProvider = getEmbeddingProvider();
  const chunks = await Promise.all(chunkText(extracted).map(async (content, index) => ({
    sourceRef: `${input.material.originalName}#chunk-${index + 1}`,
    content,
    embedding: await embeddingProvider.embedText(content)
  })));

  return {
    preview: compactPreview(extracted),
    chunks,
    sourceRefs: chunks.map((chunk) => chunk.sourceRef),
    warnings
  };
}
