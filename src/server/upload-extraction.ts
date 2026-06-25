import path from "node:path";
import zlib from "node:zlib";
import { getOCRProvider, type OCRImageInput, type OCRLayoutRegion } from "@/server/providers/ocr";

const MAX_EXTRACTED_TEXT_CHARS = 12000;
const UPLOAD_ARTIFACTS_MARKER = "LEARNBUDDY_UPLOAD_ARTIFACTS_JSON:";
const UPLOAD_ARTIFACT_SCHEMA_VERSION = "learnordie.upload-artifacts.v1";
const MAX_UPLOAD_ARTIFACT_MANIFEST_ITEMS = 24;
const MAX_UPLOAD_SLIDE_STRUCTURE_ITEMS = 64;

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

type ExtractedUploadContent = {
  text: string;
  images: OCRImageInput[];
  artifacts: ExtractedUploadArtifact[];
  slideStructures: PptxSlideStructure[];
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

type PptxTextBoxRole = "title" | "body" | "shape";

export type PptxTextBoxStructure = {
  text: string;
  role: PptxTextBoxRole;
  name?: string;
  placement?: UploadArtifactPlacement;
};

export type PptxTableStructure = {
  rows: string[][];
  placement?: UploadArtifactPlacement;
};

export type PptxChartStructure = {
  title?: string;
  text: string;
  labels?: string[];
  values?: number[];
  sourceRef?: string;
};

export type PptxImageStructure = {
  name: string;
  description?: string;
  target?: string;
  placement?: UploadArtifactPlacement;
  visualLine?: string;
};

export type PptxSlideStructure = {
  slide: number;
  title?: string;
  textBoxes: PptxTextBoxStructure[];
  tables: PptxTableStructure[];
  charts: PptxChartStructure[];
  images: PptxImageStructure[];
  notes?: string;
  layoutHints: string[];
};

export type UploadArtifactSourceKind = "pptx" | "pdf" | "image";

export type UploadArtifactPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractedUploadArtifact = {
  kind: "image";
  sourceKind: UploadArtifactSourceKind;
  name: string;
  mimeType: string;
  bytes: Buffer;
  sizeBytes: number;
  page?: number;
  slide?: number;
  placement?: UploadArtifactPlacement;
  description?: string;
  visualLine?: string;
};

export type StoredUploadArtifact = Omit<ExtractedUploadArtifact, "bytes"> & {
  storageUrl: string;
  previewUrl?: string;
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
  const transformMatch = pictureXml.match(/<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/);
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

function compactOfficeText(value: string) {
  return cleanText(value).replace(/\s+/g, " ");
}

function extractPptxShapeStructures(xml: string): PptxTextBoxStructure[] {
  const shapes: PptxTextBoxStructure[] = [];
  const shapeRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  let match: RegExpExecArray | null;

  while ((match = shapeRegex.exec(xml))) {
    const shapeXml = match[0];
    const text = compactOfficeText(extractTextFromOfficeXml(shapeXml));
    if (!text || isOfficePlaceholderText(text)) continue;

    const propertyMatch = shapeXml.match(/<p:cNvPr\b([^>]*)\/?>/);
    const attrs = propertyMatch ? parseXmlAttributes(propertyMatch[1]) : new Map<string, string>();
    const name = cleanText(attrs.get("name") ?? "");
    const placeholderType = shapeXml.match(/<p:ph\b([^>]*)\/?>/)?.[1];
    const placeholderAttrs = placeholderType ? parseXmlAttributes(placeholderType) : new Map<string, string>();
    const type = placeholderAttrs.get("type") ?? "";
    const role: PptxTextBoxRole = /title|ctrTitle/i.test(type) || /title|titel/i.test(name)
      ? "title"
      : /body|content|text/i.test(type) || /body|inhalt|text/i.test(name)
        ? "body"
        : "shape";
    const placement = extractPptxPicturePlacement(shapeXml);
    shapes.push({
      text,
      role,
      ...(name ? { name } : {}),
      ...(placement ? { placement } : {})
    });
  }

  return shapes;
}

function extractPptxTableStructures(xml: string): PptxTableStructure[] {
  const tables: PptxTableStructure[] = [];
  const frameRegex = /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
  let frameMatch: RegExpExecArray | null;

  while ((frameMatch = frameRegex.exec(xml))) {
    const frameXml = frameMatch[0];
    const tableMatch = frameXml.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/);
    if (!tableMatch) continue;
    const rows: string[][] = [];
    const rowRegex = /<a:tr\b[\s\S]*?<\/a:tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableMatch[0]))) {
      const cells: string[] = [];
      const cellRegex = /<a:tc\b[\s\S]*?<\/a:tc>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[0]))) {
        cells.push(compactOfficeText(extractTextFromOfficeXml(cellMatch[0])));
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length > 0) {
      const placement = extractPptxPicturePlacement(frameXml);
      tables.push({
        rows,
        ...(placement ? { placement } : {})
      });
    }
  }

  return tables;
}

function pptxChartStringPoints(xml: string) {
  const literals = xml.match(/<c:strLit\b[\s\S]*?<\/c:strLit>/g) ?? [];
  return literals.flatMap((literal) => {
    const values: string[] = [];
    const valueRegex = /<c:v(?:\s[^>]*)?>([\s\S]*?)<\/c:v>/g;
    let match: RegExpExecArray | null;
    while ((match = valueRegex.exec(literal))) {
      const value = compactOfficeText(decodeXmlEntities(match[1]));
      if (value) values.push(value);
    }
    return values;
  });
}

function pptxChartNumberPoints(xml: string) {
  const literals = xml.match(/<c:numLit\b[\s\S]*?<\/c:numLit>/g) ?? [];
  return literals.flatMap((literal) => {
    const values: number[] = [];
    const valueRegex = /<c:v(?:\s[^>]*)?>([\s\S]*?)<\/c:v>/g;
    let match: RegExpExecArray | null;
    while ((match = valueRegex.exec(literal))) {
      const value = Number(decodeXmlEntities(match[1]).replace(",", "."));
      if (Number.isFinite(value)) values.push(value);
    }
    return values;
  });
}

function extractPptxChartStructure(xml: string, sourceRef: string): PptxChartStructure | null {
  const text = compactOfficeText(extractTextFromOfficeXml(xml));
  const labels = pptxChartStringPoints(xml);
  const values = pptxChartNumberPoints(xml);
  const title = text.split(/\n|Diagramm:/).map((part) => cleanText(part)).find(Boolean);
  if (!text && labels.length === 0 && values.length === 0) return null;

  return {
    text,
    ...(title ? { title } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(values.length > 0 ? { values } : {}),
    sourceRef
  };
}

function pptxSlideLayoutHints(structure: Omit<PptxSlideStructure, "layoutHints">, slideSize: PptxSlideSize): string[] {
  const hints: string[] = [];
  if (structure.tables.length > 0) hints.push("table_focus");
  if (structure.charts.length > 0) hints.push("chart_focus");
  if (structure.images.some((image) => image.placement && pptxPlacementZone(image.placement, slideSize).includes("rechts"))) {
    hints.push("technical_figure_right");
  }
  if (structure.images.length > 0 && hints.length === 0) hints.push("technical_figure_left");
  if (structure.textBoxes.length > 1 && hints.length === 0) hints.push("technical_two_column");
  if (hints.length === 0) hints.push("technical_one_column");
  return [...new Set(hints)].slice(0, 4);
}

function pptxTableText(table: PptxTableStructure) {
  return table.rows.map((row) => row.filter(Boolean).join(" | ")).filter(Boolean).join("\n");
}

function pptxSlideStructureText(structure: PptxSlideStructure) {
  const parts = [
    structure.title ? `Titel: ${structure.title}` : "",
    ...structure.textBoxes
      .filter((box) => box.role !== "title")
      .map((box, index) => `Textbox ${index + 1}: ${box.text}`),
    ...structure.tables.map((table, index) => `Tabelle ${index + 1}:\n${pptxTableText(table)}`),
    ...structure.charts.map((chart, index) => `Chart ${index + 1}: ${chart.text || chart.title || chart.sourceRef}`),
    ...structure.images.map((image, index) => `Bild ${index + 1}: ${image.description || image.name}`),
    structure.notes ? `Notizen: ${structure.notes}` : ""
  ].filter(Boolean);
  return cleanText(parts.join("\n"));
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
        description: `Bildbasierte PPTX-Inhalte erkannt: ${path.posix.basename(target)} ohne Alt-Text. Für nicht getaggte Bildinhalte ist OCR oder visuelle Analyse erforderlich.`,
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

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/bmp") return ".bmp";
  if (mimeType === "image/tiff") return ".tif";
  if (mimeType === "image/svg+xml") return ".svg";
  return "";
}

function artifactNameWithExtension(name: string, mimeType: string) {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  return `${name}${extensionForMimeType(mimeType)}`;
}

function imageInputFromArtifact(artifact: ExtractedUploadArtifact): OCRImageInput {
  return {
    name: artifact.name,
    mimeType: artifact.mimeType,
    bytes: artifact.bytes,
    ...(artifact.page !== undefined ? { page: artifact.page } : {}),
    ...(artifact.placement ? { placement: artifact.placement } : {})
  };
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
  const artifacts: ExtractedUploadArtifact[] = [];
  const slideStructures: PptxSlideStructure[] = [];
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
    const chartStructures = relationships
      .filter((relationship) => relationship.type.includes("/chart"))
      .map((relationship) => extractPptxChartStructure(readZipText(buffer, entriesByName, relationship.target), relationship.target))
      .filter((chart): chart is PptxChartStructure => Boolean(chart));
    const chartTexts = chartStructures.map((chart) => chart.text).filter(Boolean);
    const imageReferences = extractImageReferencesFromSlideXml(slideXml, relationshipTargets, slideNumber, slideSize);
    for (const reference of imageReferences.filter((item) => item.target)) {
      const target = reference.target;
      if (!target || seenImageTargets.has(target)) continue;
      seenImageTargets.add(target);
      const imageEntry = entriesByName.get(target);
      const imageContent = imageEntry ? readZipEntry(buffer, imageEntry) : null;
      if (imageContent && imageContent.byteLength > 0) {
        const artifact: ExtractedUploadArtifact = {
          kind: "image",
          sourceKind: "pptx",
          name: path.posix.basename(target),
          mimeType: mimeTypeFromPath(target),
          bytes: Buffer.from(imageContent),
          sizeBytes: imageContent.byteLength,
          page: slideNumber,
          slide: slideNumber,
          description: reference.description,
          ...(reference.visualLine ? { visualLine: reference.visualLine } : {}),
          ...(reference.placement ? { placement: reference.placement } : {})
        };
        artifacts.push(artifact);
        images.push(imageInputFromArtifact(artifact));
      }
    }
    const visualStructure = imageReferences
      .map((reference) => reference.visualLine)
      .filter(Boolean);
    const textBoxes = extractPptxShapeStructures(slideXml);
    const tables = extractPptxTableStructures(slideXml);
    const title = textBoxes.find((box) => box.role === "title")?.text
      ?? slideText.split("\n").map(cleanText).find(Boolean);
    const structureBase: Omit<PptxSlideStructure, "layoutHints"> = {
      slide: slideNumber,
      ...(title ? { title } : {}),
      textBoxes,
      tables,
      charts: chartStructures,
      images: imageReferences.map((reference) => ({
        name: reference.target ? path.posix.basename(reference.target) : reference.description.replace(/^Bild:\s*/i, "Bild"),
        description: reference.description,
        ...(reference.target ? { target: reference.target } : {}),
        ...(reference.placement ? { placement: reference.placement } : {}),
        ...(reference.visualLine ? { visualLine: reference.visualLine } : {})
      })),
      ...(noteText ? { notes: noteText } : {})
    };
    const slideStructure: PptxSlideStructure = {
      ...structureBase,
      layoutHints: pptxSlideLayoutHints(structureBase, slideSize)
    };
    if (
      slideStructure.textBoxes.length > 0 ||
      slideStructure.tables.length > 0 ||
      slideStructure.charts.length > 0 ||
      slideStructure.images.length > 0 ||
      slideStructure.notes
    ) {
      slideStructures.push(slideStructure);
    }
    const parts = [
      slideText,
      ...chartTexts.map((chartText) => `Diagramm: ${chartText}`),
      ...tables.map((table, index) => `Tabelle ${index + 1}: ${pptxTableText(table)}`),
      ...imageReferences.map((reference) => reference.description),
      visualStructure.length > 0 ? `Visuelle Struktur:\n${visualStructure.join("\n")}` : "",
      pptxSlideStructureText(slideStructure) ? `Grobe Folienstruktur:\n${pptxSlideStructureText(slideStructure)}` : "",
      noteText ? `Notizen: ${noteText}` : ""
    ].filter(Boolean);
    if (parts.length > 0) slides.push(`Folie ${slideNumber}: ${parts.join("\n")}`);
  }

  return {
    text: cleanText(slides.join("\n\n")),
    images,
    artifacts,
    slideStructures
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

function extractPdfImageArtifacts(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const artifacts: ExtractedUploadArtifact[] = [];
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
        const mimeType = mimeTypeFromPdfImageDictionary(dictionary);
        artifacts.push({
          kind: "image",
          sourceKind: "pdf",
          name: artifactNameWithExtension(`pdf-image-${index}`, mimeType),
          mimeType,
          bytes: Buffer.from(content),
          sizeBytes: content.byteLength,
          description: `Eingebettetes PDF-Bild ${index}`
        });
        index += 1;
      }
    }

    cursor = streamEnd + "endstream".length;
  }

  return artifacts;
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
  const artifacts = extractPdfImageArtifacts(buffer);
  const parts = dedupeTextParts([
    ...extractPdfAccessibleText(raw),
    ...extractPdfStreams(buffer).flatMap((stream) => extractPdfStringsFromContent(stream))
  ]);

  if (imageCount > 0) {
    parts.push(`Bildbasierte PDF-Inhalte erkannt: ${imageCount} eingebettete Bilder. Für nicht getaggte Bildinhalte ist OCR oder visuelle Analyse erforderlich.`);
  }

  return {
    text: cleanText(parts.join(" ")),
    artifacts,
    images: artifacts.map(imageInputFromArtifact),
    slideStructures: []
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

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewLine(value: string, maxLength = 54) {
  const normalized = cleanText(value).replace(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function artifactSourceLabel(artifact: Pick<ExtractedUploadArtifact, "sourceKind" | "page" | "slide">) {
  if (artifact.sourceKind === "pptx" && artifact.slide !== undefined) return `Folie ${artifact.slide}`;
  if (artifact.sourceKind === "pdf" && artifact.page !== undefined) return `Seite ${artifact.page}`;
  if (artifact.sourceKind === "pdf") return "PDF-Bild";
  if (artifact.sourceKind === "image") return "Upload-Bild";
  return "Bild";
}

function storedArtifactValue(value: unknown): StoredUploadArtifact | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.kind !== "image") return null;
  if (item.sourceKind !== "pptx" && item.sourceKind !== "pdf" && item.sourceKind !== "image") return null;
  if (typeof item.name !== "string" || typeof item.mimeType !== "string" || typeof item.storageUrl !== "string") return null;
  if (typeof item.sizeBytes !== "number" || !Number.isFinite(item.sizeBytes) || item.sizeBytes < 0) return null;

  const placementCandidate = item.placement && typeof item.placement === "object"
    ? item.placement as Record<string, unknown>
    : null;
  const placement = placementCandidate
    && typeof placementCandidate.x === "number"
    && typeof placementCandidate.y === "number"
    && typeof placementCandidate.width === "number"
    && typeof placementCandidate.height === "number"
    ? {
        x: placementCandidate.x,
        y: placementCandidate.y,
        width: placementCandidate.width,
        height: placementCandidate.height
      }
    : undefined;

  return {
    kind: "image",
    sourceKind: item.sourceKind,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    storageUrl: item.storageUrl,
    ...(typeof item.previewUrl === "string" ? { previewUrl: item.previewUrl } : {}),
    ...(typeof item.page === "number" && Number.isFinite(item.page) ? { page: item.page } : {}),
    ...(typeof item.slide === "number" && Number.isFinite(item.slide) ? { slide: item.slide } : {}),
    ...(placement ? { placement } : {}),
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    ...(typeof item.visualLine === "string" ? { visualLine: item.visualLine } : {})
  };
}

function placementValue(value: unknown): UploadArtifactPlacement | undefined {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return candidate
    && typeof candidate.x === "number"
    && typeof candidate.y === "number"
    && typeof candidate.width === "number"
    && typeof candidate.height === "number"
    ? {
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height
      }
    : undefined;
}

function pptxTextBoxValue(value: unknown): PptxTextBoxStructure | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || typeof item.text !== "string") return null;
  const role = item.role === "title" || item.role === "body" || item.role === "shape" ? item.role : "shape";
  return {
    text: item.text,
    role,
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    ...(placementValue(item.placement) ? { placement: placementValue(item.placement) } : {})
  };
}

function pptxTableValue(value: unknown): PptxTableStructure | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || !Array.isArray(item.rows)) return null;
  const rows = item.rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => typeof cell === "string" ? cell : String(cell ?? "")));
  if (rows.length === 0) return null;
  return {
    rows,
    ...(placementValue(item.placement) ? { placement: placementValue(item.placement) } : {})
  };
}

function pptxChartValue(value: unknown): PptxChartStructure | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || typeof item.text !== "string") return null;
  return {
    text: item.text,
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    ...(Array.isArray(item.labels) ? { labels: item.labels.map(String).slice(0, 24) } : {}),
    ...(Array.isArray(item.values) ? { values: item.values.map(Number).filter(Number.isFinite).slice(0, 24) } : {}),
    ...(typeof item.sourceRef === "string" ? { sourceRef: item.sourceRef } : {})
  };
}

function pptxImageValue(value: unknown): PptxImageStructure | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || typeof item.name !== "string") return null;
  return {
    name: item.name,
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    ...(typeof item.target === "string" ? { target: item.target } : {}),
    ...(placementValue(item.placement) ? { placement: placementValue(item.placement) } : {}),
    ...(typeof item.visualLine === "string" ? { visualLine: item.visualLine } : {})
  };
}

function pptxSlideStructureValue(value: unknown): PptxSlideStructure | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || typeof item.slide !== "number" || !Number.isFinite(item.slide)) return null;
  return {
    slide: item.slide,
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    textBoxes: Array.isArray(item.textBoxes) ? item.textBoxes.map(pptxTextBoxValue).filter((entry): entry is PptxTextBoxStructure => Boolean(entry)) : [],
    tables: Array.isArray(item.tables) ? item.tables.map(pptxTableValue).filter((entry): entry is PptxTableStructure => Boolean(entry)) : [],
    charts: Array.isArray(item.charts) ? item.charts.map(pptxChartValue).filter((entry): entry is PptxChartStructure => Boolean(entry)) : [],
    images: Array.isArray(item.images) ? item.images.map(pptxImageValue).filter((entry): entry is PptxImageStructure => Boolean(entry)) : [],
    ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
    layoutHints: Array.isArray(item.layoutHints) ? item.layoutHints.map(String).slice(0, 8) : []
  };
}

export function stripUploadArtifactManifest(value: string) {
  return cleanText(value
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(UPLOAD_ARTIFACTS_MARKER))
    .join("\n"));
}

export function parseUploadArtifactManifest(value: string): StoredUploadArtifact[] {
  const artifacts: StoredUploadArtifact[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(UPLOAD_ARTIFACTS_MARKER)) continue;
    try {
      const manifest = JSON.parse(trimmed.slice(UPLOAD_ARTIFACTS_MARKER.length)) as unknown;
      if (!manifest || typeof manifest !== "object") continue;
      const record = manifest as Record<string, unknown>;
      if (record.schemaVersion !== UPLOAD_ARTIFACT_SCHEMA_VERSION || !Array.isArray(record.artifacts)) continue;
      for (const artifact of record.artifacts) {
        const parsed = storedArtifactValue(artifact);
        if (parsed) artifacts.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return artifacts.slice(0, MAX_UPLOAD_ARTIFACT_MANIFEST_ITEMS);
}

export function parseUploadSlideStructures(value: string): PptxSlideStructure[] {
  const structures: PptxSlideStructure[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(UPLOAD_ARTIFACTS_MARKER)) continue;
    try {
      const manifest = JSON.parse(trimmed.slice(UPLOAD_ARTIFACTS_MARKER.length)) as unknown;
      if (!manifest || typeof manifest !== "object") continue;
      const record = manifest as Record<string, unknown>;
      if (record.schemaVersion !== UPLOAD_ARTIFACT_SCHEMA_VERSION || !Array.isArray(record.slideStructures)) continue;
      for (const structure of record.slideStructures) {
        const parsed = pptxSlideStructureValue(structure);
        if (parsed) structures.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return structures.slice(0, MAX_UPLOAD_SLIDE_STRUCTURE_ITEMS);
}

export function appendUploadArtifactManifest(text: string, artifacts: StoredUploadArtifact[], slideStructures: PptxSlideStructure[] = []) {
  if (artifacts.length === 0 && slideStructures.length === 0) return text;
  const manifest = {
    schemaVersion: UPLOAD_ARTIFACT_SCHEMA_VERSION,
    artifacts: artifacts.slice(0, MAX_UPLOAD_ARTIFACT_MANIFEST_ITEMS),
    slideStructures: slideStructures.slice(0, MAX_UPLOAD_SLIDE_STRUCTURE_ITEMS)
  };
  return cleanText([
    text,
    `${UPLOAD_ARTIFACTS_MARKER}${JSON.stringify(manifest)}`
  ].join("\n\n"));
}

export function renderUploadArtifactPreviewSvg(artifact: Pick<ExtractedUploadArtifact, "name" | "mimeType" | "sourceKind" | "page" | "slide" | "description" | "visualLine">, index: number) {
  const source = artifactSourceLabel(artifact);
  const title = previewLine(artifact.description || artifact.name, 46);
  const detail = previewLine(artifact.visualLine || artifact.mimeType, 62);
  const ordinal = String(index + 1).padStart(2, "0");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${escapeSvgText(title)}">
  <rect width="640" height="360" rx="28" fill="#f5fafc"/>
  <rect x="28" y="28" width="584" height="304" rx="22" fill="#e7f1f5" stroke="#aac1cc" stroke-width="3"/>
  <path d="M120 246 C166 172 218 290 274 218 S386 144 430 236" fill="none" stroke="#0b84a5" stroke-width="16" stroke-linecap="round"/>
  <circle cx="428" cy="132" r="48" fill="#f4fbfd" stroke="#243b46" stroke-width="12"/>
  <path d="M386 162 C430 208 500 184 522 126" fill="none" stroke="#c98610" stroke-width="16" stroke-linecap="round"/>
  <text x="54" y="74" fill="#4d6370" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800">${escapeSvgText(source)} · ${ordinal}</text>
  <text x="54" y="290" fill="#061823" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="900">${escapeSvgText(title)}</text>
  <text x="54" y="318" fill="#4d6370" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700">${escapeSvgText(detail)}</text>
</svg>`;
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

export async function extractUploadContent(file: File) {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  let extractedText = "";
  let images: OCRImageInput[] = [];
  let artifacts: ExtractedUploadArtifact[] = [];
  let slideStructures: PptxSlideStructure[] = [];

  if (name.endsWith(".pptx")) {
    const extracted = extractPptxContent(buffer);
    extractedText = extracted.text;
    images = extracted.images;
    artifacts = extracted.artifacts;
    slideStructures = extracted.slideStructures;
  } else if (name.endsWith(".ppt")) {
    extractedText = extractLegacyOfficeText(buffer);
  } else if (name.endsWith(".pdf")) {
    const extracted = extractPdfContent(buffer);
    extractedText = extracted.text;
    images = extracted.images;
    artifacts = extracted.artifacts;
  } else if (file.type.startsWith("text/")) {
    extractedText = buffer.toString("utf8");
  } else if (file.type.startsWith("image/")) {
    const artifact: ExtractedUploadArtifact = {
      kind: "image",
      sourceKind: "image",
      name: file.name,
      mimeType: file.type || mimeTypeFromPath(file.name),
      bytes: buffer,
      sizeBytes: buffer.byteLength,
      description: "Direkt hochgeladenes Bild"
    };
    artifacts = [artifact];
    images = [imageInputFromArtifact(artifact)];
  }

  const ocrText = await extractOCRText(file, images);
  return {
    text: metadataForUpload(file, cleanText([extractedText, ocrText].filter(Boolean).join("\n\n"))),
    artifacts,
    slideStructures
  };
}

export async function extractUploadText(file: File) {
  return (await extractUploadContent(file)).text;
}

export function uploadStoragePath(lectureId: string, fileName: string) {
  return `lectures/${lectureId}/uploads/${safeFileName(fileName)}.txt`;
}

export function uploadArtifactStoragePath(lectureId: string, fileName: string, artifactName: string, index: number) {
  const ordinal = String(index + 1).padStart(2, "0");
  return `lectures/${lectureId}/extracted-assets/${safeFileName(fileName)}/${ordinal}-${safeFileName(artifactName)}`;
}

export function uploadArtifactPreviewStoragePath(lectureId: string, fileName: string, artifactName: string, index: number) {
  const baseName = artifactName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const ordinal = String(index + 1).padStart(2, "0");
  return `lectures/${lectureId}/extracted-assets/${safeFileName(fileName)}/${ordinal}-${safeFileName(baseName)}.preview.svg`;
}
