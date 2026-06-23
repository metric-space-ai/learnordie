import path from "node:path";
import zlib from "node:zlib";
import { getOCRProvider, type OCRImageInput, type OCRLayoutRegion } from "@/server/providers/ocr";

const MAX_EXTRACTED_TEXT_CHARS = 12000;

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

type ExtractedUploadContent = {
  text: string;
  images: OCRImageInput[];
};

type PptxSlideSize = {
  width: number;
  height: number;
};

type PptxImagePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PptxImageReference = {
  target: string;
  description: string;
  placement?: PptxImagePlacement;
  visualLine?: string;
};

const DEFAULT_PPTX_SLIDE_SIZE: PptxSlideSize = {
  width: 12_192_000,
  height: 6_858_000
};

function cleanText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeXmlAttribute(value: string | undefined) {
  return value ? decodeXmlEntities(value) : "";
}

function parseXmlAttributes(value: string) {
  const attributes = new Map<string, string>();
  const attributeRegex = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = attributeRegex.exec(value))) {
    attributes.set(match[1], decodeXmlAttribute(match[2]));
  }

  return attributes;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return [];

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount && cursor + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");

    entries.push({ name, method, compressedSize, localHeaderOffset });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return null;

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return data;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }

  return null;
}

function readZipText(buffer: Buffer, entriesByName: Map<string, ZipEntry>, name: string) {
  const entry = entriesByName.get(name.replace(/^\/+/, ""));
  if (!entry) return "";
  const content = readZipEntry(buffer, entry);
  return content ? content.toString("utf8") : "";
}

function resolveZipTarget(ownerPath: string, target: string) {
  if (!target || /^[a-z]+:/i.test(target)) return "";
  if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
  return path.posix.normalize(path.posix.join(path.posix.dirname(ownerPath), target));
}

function slideNumberFromPath(name: string) {
  const match = name.match(/ppt\/slides\/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function noteNumberFromPath(name: string) {
  const match = name.match(/ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function extractTextFromOfficeXml(xml: string) {
  const paragraphs: string[] = [];
  const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let paragraphMatch: RegExpExecArray | null;

  while ((paragraphMatch = paragraphRegex.exec(xml))) {
    const parts: string[] = [];
    const textRegex = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let textMatch: RegExpExecArray | null;

    while ((textMatch = textRegex.exec(paragraphMatch[1]))) {
      parts.push(decodeXmlEntities(textMatch[1]));
    }

    const paragraph = cleanText(parts.join(" "));
    if (paragraph && !isOfficePlaceholderText(paragraph)) paragraphs.push(paragraph);
  }

  if (paragraphs.length > 0) return cleanText(paragraphs.join("\n"));

  const parts: string[] = [];
  const textRegex = /<(?:a:t|c:v)(?:\s[^>]*)?>([\s\S]*?)<\/(?:a:t|c:v)>/g;
  let match: RegExpExecArray | null;

  while ((match = textRegex.exec(xml))) {
    parts.push(decodeXmlEntities(match[1]));
  }

  return cleanText(parts.join(" "));
}

function readPptxSlideSize(buffer: Buffer, entriesByName: Map<string, ZipEntry>): PptxSlideSize {
  const presentationXml = readZipText(buffer, entriesByName, "ppt/presentation.xml");
  const slideSizeMatch = presentationXml.match(/<p:sldSz\b([^>]*)\/?>/);
  if (!slideSizeMatch) return DEFAULT_PPTX_SLIDE_SIZE;
  const attrs = parseXmlAttributes(slideSizeMatch[1]);
  const width = Number(attrs.get("cx"));
  const height = Number(attrs.get("cy"));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return DEFAULT_PPTX_SLIDE_SIZE;
}

function extractPptxPicturePlacement(pictureXml: string): PptxImagePlacement | undefined {
  const transformMatch = pictureXml.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>/);
  if (!transformMatch) return undefined;
  const offsetMatch = transformMatch[0].match(/<a:off\b([^>]*)\/?>/);
  const extentMatch = transformMatch[0].match(/<a:ext\b([^>]*)\/?>/);
  if (!offsetMatch || !extentMatch) return undefined;
  const offset = parseXmlAttributes(offsetMatch[1]);
  const extent = parseXmlAttributes(extentMatch[1]);
  const x = Number(offset.get("x"));
  const y = Number(offset.get("y"));
  const width = Number(extent.get("cx"));
  const height = Number(extent.get("cy"));
  if ([x, y, width, height].every((value) => Number.isFinite(value) && value >= 0) && width > 0 && height > 0) {
    return { x, y, width, height };
  }
  return undefined;
}

function pptxPlacementZone(placement: PptxImagePlacement, slideSize: PptxSlideSize) {
  const centerX = placement.x + placement.width / 2;
  const centerY = placement.y + placement.height / 2;
  const horizontal = centerX < slideSize.width / 3
    ? "links"
    : centerX > (slideSize.width * 2) / 3
      ? "rechts"
      : "mittig";
  const vertical = centerY < slideSize.height / 3
    ? "oben"
    : centerY > (slideSize.height * 2) / 3
      ? "unten"
      : "mittig";
  return horizontal === "mittig" && vertical === "mittig" ? "zentral" : `${vertical} ${horizontal}`;
}

function pptxPlacementText(placement: PptxImagePlacement) {
  return `x=${Math.round(placement.x)} y=${Math.round(placement.y)} w=${Math.round(placement.width)} h=${Math.round(placement.height)} EMU`;
}

function extractImageReferencesFromSlideXml(xml: string, relationships: Map<string, string>, slideNumber: number, slideSize: PptxSlideSize) {
  const references: PptxImageReference[] = [];
  const pictureRegex = /<p:pic\b[\s\S]*?<\/p:pic>/g;
  let pictureMatch: RegExpExecArray | null;

  while ((pictureMatch = pictureRegex.exec(xml))) {
    const pictureXml = pictureMatch[0];
    const propertyMatch = pictureXml.match(/<p:cNvPr\b([^>]*)\/?>/);
    const attrs = propertyMatch ? parseXmlAttributes(propertyMatch[1]) : new Map<string, string>();
    const description = cleanText(attrs.get("descr") ?? attrs.get("title") ?? "");
    const name = cleanText(attrs.get("name") ?? "");
    const embedId = pictureXml.match(/<a:blip\b[^>]*(?:r:embed|embed)="([^"]+)"/)?.[1];
    const target = embedId ? relationships.get(embedId) : "";
    const placement = extractPptxPicturePlacement(pictureXml);
    const label = description || (name && !/^((picture|image|bild)\s*)?\d+$/i.test(name) ? name : "") || (target ? path.posix.basename(target) : "Bild");
    const visualLine = placement
      ? `Bildposition: Folie ${slideNumber} · ${label} · ${pptxPlacementZone(placement, slideSize)} · ${pptxPlacementText(placement)}`
      : "";

    if (description) {
      references.push({ target: target ?? "", description: `Bild: ${description}`, ...(placement ? { placement } : {}), ...(visualLine ? { visualLine } : {}) });
    } else if (target) {
      references.push({
        target,
        description: `Bildbasierte PPTX-Inhalte erkannt: ${path.posix.basename(target)} ohne Alt-Text. Fuer nicht getaggte Bildinhalte ist OCR oder visuelle Analyse erforderlich.`,
        ...(placement ? { placement } : {}),
        ...(visualLine ? { visualLine } : {})
      });
    } else if (name && !/^((picture|image|bild)\s*)?\d+$/i.test(name)) {
      references.push({ target: "", description: `Bild: ${name}`, ...(placement ? { placement } : {}), ...(visualLine ? { visualLine } : {}) });
    }
  }

  return references;
}

function readRelationships(buffer: Buffer, entriesByName: Map<string, ZipEntry>, ownerPath: string) {
  const relationshipPath = path.posix.join(path.posix.dirname(ownerPath), "_rels", `${path.posix.basename(ownerPath)}.rels`);
  const xml = readZipText(buffer, entriesByName, relationshipPath);
  const relationships: Array<{ id: string; type: string; target: string }> = [];
  const relationshipRegex = /<Relationship\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = relationshipRegex.exec(xml))) {
    const attrs = parseXmlAttributes(match[1]);
    const id = attrs.get("Id") ?? "";
    const target = resolveZipTarget(ownerPath, attrs.get("Target") ?? "");
    if (id && target) {
      relationships.push({
        id,
        type: attrs.get("Type") ?? "",
        target
      });
    }
  }

  return relationships;
}

function mimeTypeFromPath(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

function isOfficePlaceholderText(value: string) {
  const normalized = value.toLowerCase();
  return normalized === "click to add notes"
    || normalized === "click to add text"
    || normalized === "klicken sie, um notizen hinzuzufügen"
    || normalized === "klicken sie, um text hinzuzufügen"
    || normalized === "notizen hinzufügen";
}

function extractPptxContent(buffer: Buffer): ExtractedUploadContent {
  const allEntries = readZipEntries(buffer);
  const entriesByName = new Map(allEntries.map((entry) => [entry.name, entry]));
  const slideSize = readPptxSlideSize(buffer, entriesByName);
  const slideEntries = allEntries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((left, right) => slideNumberFromPath(left.name) - slideNumberFromPath(right.name));
  const noteEntries = new Map(allEntries
    .filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.name))
    .map((entry) => [noteNumberFromPath(entry.name), entry]));

  const slides: string[] = [];
  const images: OCRImageInput[] = [];
  const seenImageTargets = new Set<string>();
  for (const entry of slideEntries) {
    const slideNumber = slideNumberFromPath(entry.name);
    const content = readZipEntry(buffer, entry);
    if (!content) continue;

    const slideXml = content.toString("utf8");
    const slideText = extractTextFromOfficeXml(slideXml);
    const relationships = readRelationships(buffer, entriesByName, entry.name);
    const relationshipTargets = new Map(relationships.map((relationship) => [relationship.id, relationship.target]));
    const noteTarget = relationships.find((relationship) => relationship.type.includes("/notesSlide"))?.target;
    const noteText = noteTarget
      ? extractTextFromOfficeXml(readZipText(buffer, entriesByName, noteTarget))
      : noteEntries.get(slideNumber)
        ? extractTextFromOfficeXml(readZipEntry(buffer, noteEntries.get(slideNumber)!)?.toString("utf8") ?? "")
        : "";
    const chartTexts = relationships
      .filter((relationship) => relationship.type.includes("/chart"))
      .map((relationship) => extractTextFromOfficeXml(readZipText(buffer, entriesByName, relationship.target)))
      .filter(Boolean);
    const imageReferences = extractImageReferencesFromSlideXml(slideXml, relationshipTargets, slideNumber, slideSize);
    for (const reference of imageReferences.filter((item) => item.target)) {
      const target = reference.target;
      if (!target || seenImageTargets.has(target)) continue;
      seenImageTargets.add(target);
      const imageEntry = entriesByName.get(target);
      const imageContent = imageEntry ? readZipEntry(buffer, imageEntry) : null;
      if (imageContent && imageContent.byteLength > 0) {
        images.push({
          name: path.posix.basename(target),
          mimeType: mimeTypeFromPath(target),
          bytes: Buffer.from(imageContent),
          page: slideNumber,
          ...(reference.placement ? { placement: reference.placement } : {})
        });
      }
    }
    const visualStructure = imageReferences
      .map((reference) => reference.visualLine)
      .filter(Boolean);
    const parts = [
      slideText,
      ...chartTexts.map((chartText) => `Diagramm: ${chartText}`),
      ...imageReferences.map((reference) => reference.description),
      visualStructure.length > 0 ? `Visuelle Struktur:\n${visualStructure.join("\n")}` : "",
      noteText ? `Notizen: ${noteText}` : ""
    ].filter(Boolean);
    if (parts.length > 0) slides.push(`Folie ${slideNumber}: ${parts.join("\n")}`);
  }

  return {
    text: cleanText(slides.join("\n\n")),
    images
  };
}

function decodePdfLiteral(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = value[index + 1];
    if (!next) continue;
    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next)) {
      const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? next;
      output += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length - 1;
    } else {
      output += next;
    }
    index += 1;
  }
  return output;
}

function decodePdfHex(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length < 2) return "";
  const bytes = Buffer.from(normalized.length % 2 === 0 ? normalized : `${normalized}0`, "hex");

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode(bytes.readUInt16BE(index));
    }
    return output;
  }

  return bytes.toString("latin1");
}

type PdfToken =
  | { type: "array"; value: string[] }
  | { type: "operator"; value: string }
  | { type: "string"; value: string };

function isPdfDelimiter(char: string) {
  return /\s/.test(char) || char === "/" || char === "<" || char === ">" || char === "[" || char === "]" || char === "(" || char === ")";
}

function parsePdfLiteralAt(content: string, start: number) {
  let value = "";
  let depth = 1;
  let index = start + 1;

  while (index < content.length) {
    const char = content[index];
    if (char === "\\") {
      value += char;
      if (index + 1 < content.length) {
        value += content[index + 1];
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return { value: decodePdfLiteral(value), end: index + 1 };
    }
    value += char;
    index += 1;
  }

  return { value: decodePdfLiteral(value), end: index };
}

function parsePdfHexAt(content: string, start: number) {
  const end = content.indexOf(">", start + 1);
  if (end < 0) return { value: "", end: content.length };
  return {
    value: decodePdfHex(content.slice(start + 1, end)),
    end: end + 1
  };
}

function parsePdfArrayAt(content: string, start: number) {
  const values: string[] = [];
  let index = start + 1;

  while (index < content.length) {
    const char = content[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "]") return { value: values, end: index + 1 };
    if (char === "(") {
      const parsed = parsePdfLiteralAt(content, index);
      if (parsed.value) values.push(parsed.value);
      index = parsed.end;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      const parsed = parsePdfHexAt(content, index);
      if (parsed.value) values.push(parsed.value);
      index = parsed.end;
      continue;
    }
    index += 1;
  }

  return { value: values, end: index };
}

function tokenizePdfContent(content: string) {
  const tokens: PdfToken[] = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "%") {
      const nextLine = content.indexOf("\n", index + 1);
      index = nextLine < 0 ? content.length : nextLine + 1;
      continue;
    }
    if (char === "(") {
      const parsed = parsePdfLiteralAt(content, index);
      if (parsed.value) tokens.push({ type: "string", value: parsed.value });
      index = parsed.end;
      continue;
    }
    if (char === "<") {
      if (content[index + 1] === "<") {
        index += 2;
        continue;
      }
      const parsed = parsePdfHexAt(content, index);
      if (parsed.value) tokens.push({ type: "string", value: parsed.value });
      index = parsed.end;
      continue;
    }
    if (char === "[") {
      const parsed = parsePdfArrayAt(content, index);
      if (parsed.value.length > 0) tokens.push({ type: "array", value: parsed.value });
      index = parsed.end;
      continue;
    }
    if (char === "/" || char === ">" || char === "]") {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < content.length && !isPdfDelimiter(content[end])) end += 1;
    const value = content.slice(index, end);
    if (/^[A-Za-z*'"0-9.+-]+$/.test(value)) tokens.push({ type: "operator", value });
    index = end;
  }

  return tokens;
}

function appendPdfText(parts: string[], token: PdfToken | undefined) {
  if (!token) return;
  const value = token.type === "array" ? token.value.join("") : token.type === "string" ? token.value : "";
  const cleaned = cleanText(value);
  if (/[A-Za-zÄÖÜäöüß0-9]/.test(cleaned)) parts.push(cleaned);
}

function extractPdfTextOperators(content: string) {
  const tokens = tokenizePdfContent(content);
  const parts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "operator") continue;
    if (token.value === "Tj" || token.value === "TJ" || token.value === "'" || token.value === "\"") {
      appendPdfText(parts, tokens[index - 1]);
    }
    if (token.value === "T*" || token.value === "ET") {
      parts.push("\n");
    }
  }

  return parts.filter((part) => part.trim());
}

function extractPdfStringsFromContent(content: string) {
  const operatorText = extractPdfTextOperators(content);
  if (operatorText.length > 0) return operatorText;

  const parts: string[] = [];
  const literalRegex = /\((?:\\.|[^\\)])*\)/g;
  const hexRegex = /<([0-9a-fA-F\s]{4,})>/g;
  let match: RegExpExecArray | null;

  while ((match = literalRegex.exec(content))) {
    const literal = match[0].slice(1, -1);
    const decoded = decodePdfLiteral(literal);
    if (/[A-Za-zÄÖÜäöüß0-9]/.test(decoded)) parts.push(decoded);
  }

  while ((match = hexRegex.exec(content))) {
    const decoded = decodePdfHex(match[1]);
    if (/[A-Za-zÄÖÜäöüß0-9]/.test(decoded)) parts.push(decoded);
  }

  return parts;
}

function extractPdfStreams(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const streams: string[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const streamStart = raw.indexOf("stream", cursor);
    if (streamStart < 0) break;
    const dataStart = raw[streamStart + 6] === "\r" && raw[streamStart + 7] === "\n"
      ? streamStart + 8
      : raw[streamStart + 6] === "\n"
        ? streamStart + 7
        : streamStart + 6;
    const streamEnd = raw.indexOf("endstream", dataStart);
    if (streamEnd < 0) break;

    const dictionary = raw.slice(Math.max(0, streamStart - 1200), streamStart);
    const data = buffer.subarray(dataStart, streamEnd);
    let content: Buffer | null = data;
    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        content = zlib.inflateSync(data);
      } catch {
        content = null;
      }
    }

    if (content) streams.push(content.toString("latin1"));
    cursor = streamEnd + "endstream".length;
  }

  return streams.length > 0 ? streams : [raw];
}

function mimeTypeFromPdfImageDictionary(dictionary: string) {
  if (/\/DCTDecode\b/.test(dictionary)) return "image/jpeg";
  if (/\/JPXDecode\b/.test(dictionary)) return "image/jp2";
  if (/\/JBIG2Decode\b/.test(dictionary)) return "image/jbig2";
  if (/\/CCITTFaxDecode\b/.test(dictionary)) return "image/tiff";
  return "application/octet-stream";
}

function extractPdfImagePayloads(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const images: OCRImageInput[] = [];
  let cursor = 0;
  let index = 1;

  while (cursor < raw.length) {
    const streamStart = raw.indexOf("stream", cursor);
    if (streamStart < 0) break;
    const dataStart = raw[streamStart + 6] === "\r" && raw[streamStart + 7] === "\n"
      ? streamStart + 8
      : raw[streamStart + 6] === "\n"
        ? streamStart + 7
        : streamStart + 6;
    const streamEnd = raw.indexOf("endstream", dataStart);
    if (streamEnd < 0) break;

    const dictionary = raw.slice(Math.max(0, streamStart - 1600), streamStart);
    if (/\/Subtype\s*\/Image\b/.test(dictionary)) {
      const data = buffer.subarray(dataStart, streamEnd);
      let content: Buffer | null = data;
      if (/\/FlateDecode\b/.test(dictionary)) {
        try {
          content = zlib.inflateSync(data);
        } catch {
          content = null;
        }
      }
      if (content && content.byteLength > 0) {
        images.push({
          name: `pdf-image-${index}`,
          mimeType: mimeTypeFromPdfImageDictionary(dictionary),
          bytes: Buffer.from(content)
        });
        index += 1;
      }
    }

    cursor = streamEnd + "endstream".length;
  }

  return images;
}

function extractPdfAccessibleText(raw: string) {
  const parts: string[] = [];
  const textMarkerRegex = /\/(Alt|ActualText)\s*(\(|<)/g;
  let match: RegExpExecArray | null;

  while ((match = textMarkerRegex.exec(raw))) {
    const valueStart = match.index + match[0].length - 1;
    const parsed = match[2] === "("
      ? parsePdfLiteralAt(raw, valueStart)
      : parsePdfHexAt(raw, valueStart);
    const text = cleanText(parsed.value);
    if (/[A-Za-zÄÖÜäöüß0-9]/.test(text)) parts.push(text);
    textMarkerRegex.lastIndex = parsed.end;
  }

  return parts;
}

function countPdfImages(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  return raw.match(/\/Subtype\s*\/Image\b/g)?.length ?? 0;
}

function dedupeTextParts(parts: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const part of parts.map(cleanText).filter(Boolean)) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(part);
  }

  return deduped;
}

function extractPdfContent(buffer: Buffer): ExtractedUploadContent {
  const raw = buffer.toString("latin1");
  const imageCount = countPdfImages(buffer);
  const parts = dedupeTextParts([
    ...extractPdfAccessibleText(raw),
    ...extractPdfStreams(buffer).flatMap((stream) => extractPdfStringsFromContent(stream))
  ]);

  if (imageCount > 0) {
    parts.push(`Bildbasierte PDF-Inhalte erkannt: ${imageCount} eingebettete Bilder. Fuer nicht getaggte Bildinhalte ist OCR oder visuelle Analyse erforderlich.`);
  }

  return {
    text: cleanText(parts.join(" ")),
    images: extractPdfImagePayloads(buffer)
  };
}

function extractLegacyOfficeText(buffer: Buffer) {
  const latinParts = buffer.toString("latin1").match(/[A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9.,;:!?()/%+\-\s]{12,}/g) ?? [];
  const unicodeParts = buffer.toString("utf16le").match(/[A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9.,;:!?()/%+\-\s]{12,}/g) ?? [];
  return cleanText([...latinParts, ...unicodeParts].join("\n"));
}

function safeFileName(name: string) {
  return name.replace(/[\\/]+/g, "_").trim() || "upload";
}

function metadataForUpload(file: File, extractedText: string) {
  const lines = [
    `Originaldatei: ${safeFileName(file.name)}`,
    `Typ: ${file.type || "unbekannt"}`,
    `Groesse: ${file.size}`,
    ""
  ];

  if (extractedText) {
    lines.push("Extrahierter Text:", extractedText.slice(0, MAX_EXTRACTED_TEXT_CHARS));
  } else {
    lines.push(
      "Extrahierter Text:",
      "Keine verwertbaren Textinhalte gefunden. Die Originaldatei bleibt als Materialquelle gespeichert."
    );
  }

  return cleanText(lines.join("\n"));
}

async function extractOCRText(file: File, images: OCRImageInput[]) {
  if (images.length === 0) return "";
  const provider = getOCRProvider();
  if (provider.name === "disabled") return "";

  try {
    const result = await provider.extractText({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      language: "de",
      images
    });
    const text = cleanText(result.text);
    if (!text) return "";
    const confidence = result.confidence !== undefined ? `, Konfidenz ${Math.round(result.confidence * 100)}%` : "";
    const model = result.model ? `, Modell ${result.model}` : "";
    return cleanText([
      `OCR/Visuelle Analyse (${provider.name}${model}${confidence}):`,
      text,
      ocrLayoutText(result.layout)
    ].join("\n"));
  } catch {
    return "";
  }
}

function ocrLayoutText(layout?: OCRLayoutRegion[]) {
  const regions = (layout ?? [])
    .map((region) => {
      const parts = [
        region.page !== undefined ? `Seite ${region.page}` : "",
        region.label ? region.label : "",
        region.text ? `"${region.text}"` : "",
        region.bbox ? `x=${Math.round(region.bbox.x)} y=${Math.round(region.bbox.y)} w=${Math.round(region.bbox.width)} h=${Math.round(region.bbox.height)}` : ""
      ].filter(Boolean);
      return parts.join(" · ");
    })
    .filter(Boolean)
    .slice(0, 8);
  if (regions.length === 0) return "";
  return [
    "OCR-Layout:",
    ...regions
  ].join("\n");
}

export async function extractUploadText(file: File) {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  let extractedText = "";
  let images: OCRImageInput[] = [];

  if (name.endsWith(".pptx")) {
    const extracted = extractPptxContent(buffer);
    extractedText = extracted.text;
    images = extracted.images;
  } else if (name.endsWith(".ppt")) {
    extractedText = extractLegacyOfficeText(buffer);
  } else if (name.endsWith(".pdf")) {
    const extracted = extractPdfContent(buffer);
    extractedText = extracted.text;
    images = extracted.images;
  } else if (file.type.startsWith("text/")) {
    extractedText = buffer.toString("utf8");
  } else if (file.type.startsWith("image/")) {
    images = [{ name: file.name, mimeType: file.type, bytes: buffer }];
  }

  const ocrText = await extractOCRText(file, images);
  return metadataForUpload(file, cleanText([extractedText, ocrText].filter(Boolean).join("\n\n")));
}

export function uploadStoragePath(lectureId: string, fileName: string) {
  return `lectures/${lectureId}/uploads/${safeFileName(fileName)}.txt`;
}
