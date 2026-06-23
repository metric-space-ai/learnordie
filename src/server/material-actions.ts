import type { LectureMaterial } from "@/lib/types";
import { getStorageProvider } from "@/server/providers/storage";
import { getLectureRepository } from "@/server/repository";
import { extractUploadText, uploadStoragePath } from "./upload-extraction";

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MULTIPART_FORM_OVERHEAD_BYTES = 256 * 1024;

function inferKind(name: string): LectureMaterial["kind"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(mp3|wav|m4a|aac|ogg|oga|webm)$/i.test(lower)) return "audio";
  return "other";
}

function safeFileName(name: string) {
  return name.replace(/[\\/]+/g, "_").trim() || "upload";
}

function audioStoragePath(lectureId: string, fileName: string) {
  return `lectures/${lectureId}/audio/${safeFileName(fileName)}`;
}

export class MaterialUploadLimitError extends Error {
  readonly code = "material_upload_too_large";

  constructor(
    readonly fileName: string,
    readonly sizeBytes: number,
    readonly maxBytes: number
  ) {
    super(`Die Datei "${fileName}" ist größer als das Uploadlimit von ${formatBytes(maxBytes)}.`);
  }
}

export class MaterialLectureAccessError extends Error {
  readonly code = "material_lecture_not_found";

  constructor(readonly lectureId: string) {
    super("Vorlesung nicht gefunden.");
  }
}

export function getMaterialUploadLimitBytes() {
  const configured = Number(process.env.LEARNBUDDY_MAX_UPLOAD_BYTES);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export function getMaterialUploadRequestLimitBytes() {
  return getMaterialUploadLimitBytes() + MULTIPART_FORM_OVERHEAD_BYTES;
}

export function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.max(0, Math.round(value))} B`;
}

export function materialUploadErrorMessage(error: MaterialUploadLimitError) {
  return `Datei zu groß: ${error.fileName} hat ${formatBytes(error.sizeBytes)}. Erlaubt sind ${formatBytes(error.maxBytes)}.`;
}

export async function addLectureMaterialsFromForm(lectureId: string, formData: FormData, ownerEmail?: string) {
  const file = formData.get("file");
  const url = String(formData.get("url") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const storage = getStorageProvider();
  const repository = getLectureRepository();
  const created: LectureMaterial[] = [];
  const canAccessLecture = (await repository.listLectures(ownerEmail)).some((lecture) => lecture.id === lectureId);

  if (!canAccessLecture) {
    throw new MaterialLectureAccessError(lectureId);
  }

  if (file instanceof File && file.name) {
    const maxUploadBytes = getMaterialUploadLimitBytes();
    if (file.size > maxUploadBytes) {
      throw new MaterialUploadLimitError(file.name, file.size, maxUploadBytes);
    }

    const kind = inferKind(file.name);
    const storageResult = kind === "audio"
      ? await storage.putBytes(
          audioStoragePath(lectureId, file.name),
          Buffer.from(await file.arrayBuffer()),
          file.type || "application/octet-stream"
        )
      : await storage.putText(
          uploadStoragePath(lectureId, file.name),
          await extractUploadText(file),
          "text/plain"
        );
    const material = await repository.addMaterial(lectureId, {
      kind,
      source: "upload",
      originalName: file.name,
      storageUrl: storageResult.url,
      sizeBytes: file.size
    }, ownerEmail);
    if (material) created.push(material);
  }

  if (url) {
    const storageResult = await storage.putText(`lectures/${lectureId}/urls/${encodeURIComponent(url)}.txt`, url, "text/plain");
    const material = await repository.addMaterial(lectureId, {
      kind: "url",
      source: "url",
      originalName: url,
      storageUrl: storageResult.url
    }, ownerEmail);
    if (material) created.push(material);
  }

  if (notes) {
    const storageResult = await storage.putText(`lectures/${lectureId}/notes/${Date.now()}.txt`, notes, "text/plain");
    const material = await repository.addMaterial(lectureId, {
      kind: "notes",
      source: "notes",
      originalName: "Planungsnotiz",
      storageUrl: storageResult.url,
      sizeBytes: notes.length
    }, ownerEmail);
    if (material) created.push(material);
  }

  return created;
}
