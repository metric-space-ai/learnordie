import { notFound } from "next/navigation";
import crypto from "node:crypto";
import {
  renderStandaloneSlideDocumentHtml,
  SLIDE_STANDALONE_RENDERER_VERSION,
  standaloneScript,
  standaloneStyles,
  type StandaloneAudioSource
} from "@learnordie/slide-engine";

import { buildLegacyLectureSlideDocument } from "@/lib/slide-documents";
import type { Lecture } from "@/lib/types";
import { getLecturerSession } from "@/server/auth";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getStorageProvider } from "@/server/providers/storage";
import { getLectureRepository } from "@/server/repository";
import { createZipArchive } from "@/server/zip";

const EXPORT_SCHEMA_VERSION = "standalone-html-v2";
const ARCHIVE_SCHEMA_VERSION = "standalone-archive-v1";
const MANIFEST_SCHEMA_VERSION = "learnbuddy-standalone-manifest-v1";
const ACCESSIBILITY_BASELINE = {
  target: "WCAG 2.2 AA baseline",
  language: "de",
  features: [
    "semantic-landmarks",
    "skip-link",
    "keyboard-quiz-navigation",
    "visible-focus",
    "aria-live-feedback",
    "self-contained-no-external-fonts"
  ]
};

type AudioAsset = {
  path: string;
  originalName: string;
  mediaType: string;
  bytes: Buffer;
  sha256: string;
  source: "upload" | "fallback";
};

type AudioSegment = {
  path: string;
  originalName: string;
  sourcePath: string;
  slideIndex: number;
  slideTitle: string;
  mediaType: "audio/wav";
  bytes: Buffer;
  sha256: string;
  startSeconds: number;
  endSeconds: number;
  source: "upload" | "fallback";
};

function sha256(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeArchiveName(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "datei";
}

function audioMediaType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "audio/wav";
}

function createSilentWav(durationSeconds = 1) {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function readPcmWav(buffer: Buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let fmtData: Buffer | null = null;
  let audioFormat = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataEnd = -1;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) break;

    if (chunkId === "fmt ") {
      fmtData = Buffer.from(buffer.subarray(chunkStart, chunkEnd));
      if (fmtData.length >= 16) {
        audioFormat = fmtData.readUInt16LE(0);
        sampleRate = fmtData.readUInt32LE(4);
        byteRate = fmtData.readUInt32LE(8);
        blockAlign = fmtData.readUInt16LE(12);
        bitsPerSample = fmtData.readUInt16LE(14);
      }
    }

    if (chunkId === "data") {
      dataStart = chunkStart;
      dataEnd = chunkEnd;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!fmtData || dataStart < 0 || dataEnd <= dataStart || audioFormat !== 1 || blockAlign <= 0 || sampleRate <= 0) {
    return null;
  }

  return {
    fmtData,
    sampleRate,
    byteRate: byteRate > 0 ? byteRate : sampleRate * blockAlign,
    blockAlign,
    bitsPerSample,
    data: buffer.subarray(dataStart, dataEnd)
  };
}

function pcmWavBytes(fmtData: Buffer, pcmData: Buffer) {
  const fmtPad = fmtData.length % 2;
  const dataPad = pcmData.length % 2;
  const totalSize = 4 + 8 + fmtData.length + fmtPad + 8 + pcmData.length + dataPad;
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0);
  riff.writeUInt32LE(totalSize, 4);
  riff.write("WAVE", 8);

  const fmtHeader = Buffer.alloc(8);
  fmtHeader.write("fmt ", 0);
  fmtHeader.writeUInt32LE(fmtData.length, 4);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0);
  dataHeader.writeUInt32LE(pcmData.length, 4);

  return Buffer.concat([
    riff,
    fmtHeader,
    fmtData,
    Buffer.alloc(fmtPad),
    dataHeader,
    pcmData,
    Buffer.alloc(dataPad)
  ]);
}

function audioSegmentName(asset: AudioAsset, slideIndex: number) {
  const baseName = safeArchiveName(asset.originalName).replace(/\.[a-z0-9]+$/i, "") || "dozenten-audio";
  return `audio/segments/slide-${String(slideIndex).padStart(2, "0")}-${baseName}.wav`;
}

function createAudioSegments(lecture: Lecture, audioAssets: AudioAsset[]): AudioSegment[] {
  const slideCount = lecture.slides.length;
  if (slideCount === 0) return [];

  const segments: AudioSegment[] = [];

  for (const asset of audioAssets) {
    const wav = readPcmWav(asset.bytes);
    if (!wav) continue;

    const totalFrames = Math.floor(wav.data.length / wav.blockAlign);
    if (totalFrames <= 0) continue;

    for (let index = 0; index < slideCount; index += 1) {
      const startFrame = Math.floor((index * totalFrames) / slideCount);
      const endFrame = Math.floor(((index + 1) * totalFrames) / slideCount);
      if (endFrame <= startFrame) continue;

      const pcmStart = startFrame * wav.blockAlign;
      const pcmEnd = endFrame * wav.blockAlign;
      const bytes = pcmWavBytes(wav.fmtData, Buffer.from(wav.data.subarray(pcmStart, pcmEnd)));
      const slide = lecture.slides[index];
      segments.push({
        path: audioSegmentName(asset, index + 1),
        originalName: `Folie ${index + 1} - ${asset.originalName}`,
        sourcePath: asset.path,
        slideIndex: index + 1,
        slideTitle: slide?.title ?? `Folie ${index + 1}`,
        mediaType: "audio/wav",
        bytes,
        sha256: sha256(bytes),
        startSeconds: Number((startFrame / (wav.byteRate / wav.blockAlign)).toFixed(3)),
        endSeconds: Number((endFrame / (wav.byteRate / wav.blockAlign)).toFixed(3)),
        source: asset.source
      });
    }
  }

  return segments;
}

async function collectAudioAssets(lecture: Lecture, fallbackAudio: Buffer) {
  const audioMaterials = (lecture.materials ?? []).filter((material) => material.kind === "audio");
  const entries: AudioAsset[] = [];

  for (const material of audioMaterials) {
    try {
      const bytes = await getStorageProvider().readBytes(material.storageUrl);
      const fileName = safeArchiveName(material.originalName);
      entries.push({
        path: `audio/${fileName}`,
        originalName: material.originalName,
        mediaType: audioMediaType(material.originalName),
        bytes,
        sha256: sha256(bytes),
        source: "upload"
      });
    } catch {
      // If a referenced audio object is gone, keep the export usable via fallback audio.
    }
  }

  if (entries.length > 0) return entries;

  return [{
    path: "audio/dozenten-audio-fallback.wav",
    originalName: "dozenten-audio-fallback.wav",
    mediaType: "audio/wav",
    bytes: fallbackAudio,
    sha256: sha256(fallbackAudio),
    source: "fallback" as const
  }];
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const requestUrl = new URL(request.url);
  const format = requestUrl.searchParams.get("format");
  const shouldRecordExport = requestUrl.searchParams.get("record") !== "0";
  const repository = getLectureRepository();
  const lecture = await repository.getLectureByToken(token);
  if (!lecture) notFound();
  const lecturerSession = await getLecturerSession();
  const recordOwnerEmail = shouldRecordExport ? lecturerSession?.email : undefined;

  const exportedAt = new Date().toISOString();
  const version = `${EXPORT_SCHEMA_VERSION}-${exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  const audioBytes = createSilentWav();
  const audioAssets = await collectAudioAssets(lecture, audioBytes);
  const slideDocument = lecture.slideDocument ?? buildLegacyLectureSlideDocument({
    id: lecture.id,
    title: lecture.title,
    seriesTitle: lecture.seriesTitle,
    language: lecture.language,
    slides: lecture.slides
  });
  const audioSources: StandaloneAudioSource[] = audioAssets.map((asset) => ({
    path: asset.path,
    originalName: asset.originalName,
    mediaType: asset.mediaType,
    src: `data:${asset.mediaType};base64,${asset.bytes.toString("base64")}`,
    sha256: asset.sha256,
    source: asset.source
  }));
  const styles = standaloneStyles();
  const script = standaloneScript();
  const canonicalPayload = {
    export: {
      version,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      slideEngine: {
        renderer: SLIDE_STANDALONE_RENDERER_VERSION,
        slideDocumentSchemaVersion: slideDocument.schemaVersion,
        slideDocumentId: slideDocument.id
      },
      exportedAt,
      lectureToken: lecture.publicToken,
      offline: {
        selfContained: true,
        externalAssets: 0,
        serverFeaturesExcluded: ["server-ki", "analytics-sync", "live-realtime"]
      },
      accessibility: ACCESSIBILITY_BASELINE,
      audio: {
        mode: audioAssets.some((asset) => asset.source === "upload") ? "bundled-upload" : "inline-fallback",
        files: audioAssets.map((asset) => ({
          path: asset.path,
          originalName: asset.originalName,
          mimeType: asset.mediaType,
          bytes: asset.bytes.length,
          sha256: asset.sha256,
          source: asset.source
        }))
      }
    },
    lecture: {
      title: lecture.title,
      seriesTitle: lecture.seriesTitle,
      examDate: lecture.examDate,
      learnQuestionDensity: lecture.learnQuestionDensity,
      slideDocument,
      slides: lecture.slides,
      questions: lecture.questions
    }
  };
  const payloadJson = JSON.stringify(canonicalPayload);
  const payloadSha256 = sha256(payloadJson);
  const assets = [
    { path: "assets/styles.css", role: "style", mediaType: "text/css", bytes: Buffer.byteLength(styles), sha256: sha256(styles), embeddedAs: "style-tag" },
    { path: "assets/standalone.js", role: "interaction", mediaType: "text/javascript", bytes: Buffer.byteLength(script), sha256: sha256(script), embeddedAs: "script-tag" },
    ...audioAssets.map((asset) => ({
      path: asset.path,
      role: asset.source === "upload" ? "dozenten-audio" : "audio-fallback",
      mediaType: asset.mediaType,
      bytes: asset.bytes.length,
      sha256: asset.sha256,
      embeddedAs: "data-uri-or-archive-entry"
    })),
    { path: "learnbuddy-data.json", role: "data", mediaType: "application/json", bytes: Buffer.byteLength(payloadJson), sha256: payloadSha256, embeddedAs: "application-json-script" }
  ];
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportVersion: version,
    slideEngine: {
      renderer: SLIDE_STANDALONE_RENDERER_VERSION,
      slideDocumentSchemaVersion: slideDocument.schemaVersion,
      slideDocumentId: slideDocument.id
    },
    createdAt: exportedAt,
    selfContained: true,
    externalAssetCount: 0,
    accessibility: ACCESSIBILITY_BASELINE,
    assets,
    integrity: {
      payloadSha256,
      responseSha256Header: "x-learnbuddy-sha256",
      manifestSha256Header: "x-learnbuddy-manifest-sha256"
    }
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestSha256 = sha256(manifestJson);
  const data = JSON.stringify({
    ...canonicalPayload,
    export: {
      ...canonicalPayload.export,
      payloadSha256,
      manifestSha256
    },
    manifest
  });

  const html = renderStandaloneSlideDocumentHtml({
    assetUrlMode: "inline-only",
    audioSources,
    dataJson: data,
    document: slideDocument,
    manifestJson,
    metadata: {
      version,
      exportedAt,
      title: lecture.title,
      seriesTitle: lecture.seriesTitle,
      payloadSha256,
      manifestSha256,
      selfContained: true,
      externalAssetCount: 0
    },
    questions: lecture.questions
  });
  const responseSha256 = sha256(html);
  if (format === "zip") {
    const archiveVersion = version.replace(EXPORT_SCHEMA_VERSION, ARCHIVE_SCHEMA_VERSION);
    const audioSegments = createAudioSegments(lecture, audioAssets);
    const segmentAssets = audioSegments.map((segment) => ({
      path: segment.path,
      role: segment.source === "upload" ? "dozenten-audio-segment" : "audio-fallback-segment",
      mediaType: segment.mediaType,
      bytes: segment.bytes.length,
      sha256: segment.sha256,
      embeddedAs: "archive-entry",
      sourcePath: segment.sourcePath,
      slideIndex: segment.slideIndex,
      slideTitle: segment.slideTitle,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds
    }));
    const archivePayload = {
      ...canonicalPayload,
      export: {
        ...canonicalPayload.export,
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        version: archiveVersion,
        audio: {
          ...canonicalPayload.export.audio,
          segments: audioSegments.map((segment) => ({
            path: segment.path,
            originalName: segment.originalName,
            sourcePath: segment.sourcePath,
            slideIndex: segment.slideIndex,
            slideTitle: segment.slideTitle,
            mimeType: segment.mediaType,
            bytes: segment.bytes.length,
            sha256: segment.sha256,
            source: segment.source,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds
          }))
        }
      }
    };
    const archivePayloadJson = JSON.stringify(archivePayload);
    const archivePayloadSha256 = sha256(archivePayloadJson);
    const archiveData = {
      ...archivePayload,
      export: {
        ...archivePayload.export,
        payloadSha256: archivePayloadSha256
      }
    };
    const archiveDataJson = JSON.stringify(archiveData, null, 2);
    const archiveAssets = [
      {
        path: "index.html",
        role: "root-document",
        mediaType: "text/html",
        bytes: Buffer.byteLength(html),
        sha256: responseSha256,
        embeddedAs: "archive-entry"
      },
      {
        path: "learnbuddy-data.json",
        role: "data",
        mediaType: "application/json",
        bytes: Buffer.byteLength(archiveDataJson),
        sha256: sha256(archiveDataJson),
        embeddedAs: "archive-entry"
      },
      { path: "assets/styles.css", role: "style", mediaType: "text/css", bytes: Buffer.byteLength(styles), sha256: sha256(styles), embeddedAs: "archive-entry" },
      { path: "assets/standalone.js", role: "interaction", mediaType: "text/javascript", bytes: Buffer.byteLength(script), sha256: sha256(script), embeddedAs: "archive-entry" },
      ...audioAssets.map((asset) => ({
        path: asset.path,
        role: asset.source === "upload" ? "dozenten-audio" : "audio-fallback",
        mediaType: asset.mediaType,
        bytes: asset.bytes.length,
        sha256: asset.sha256,
        embeddedAs: "archive-entry"
      })),
      ...segmentAssets
    ];
    const archiveManifest = {
      ...manifest,
      archiveSchemaVersion: ARCHIVE_SCHEMA_VERSION,
      exportVersion: archiveVersion,
      selfContained: true,
      rootDocument: "index.html",
      assets: archiveAssets,
      audioSegments: audioSegments.map((segment) => ({
        path: segment.path,
        sourcePath: segment.sourcePath,
        slideIndex: segment.slideIndex,
        slideTitle: segment.slideTitle,
        mimeType: segment.mediaType,
        bytes: segment.bytes.length,
        sha256: segment.sha256,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds
      })),
      integrity: {
        ...manifest.integrity,
        payloadSha256: archivePayloadSha256
      }
    };
    const archiveManifestJson = JSON.stringify(archiveManifest, null, 2);
    const zip = createZipArchive([
      { name: "index.html", data: html },
      { name: "learnbuddy-manifest.json", data: archiveManifestJson },
      { name: "learnbuddy-data.json", data: archiveDataJson },
      { name: "assets/styles.css", data: styles },
      { name: "assets/standalone.js", data: script },
      ...audioAssets.map((asset) => ({ name: asset.path, data: asset.bytes })),
      ...audioSegments.map((segment) => ({ name: segment.path, data: segment.bytes }))
    ]);
    const archiveSha256 = sha256(zip);
    if (recordOwnerEmail) {
      await repository.recordStandaloneExport({
        lectureId: lecture.id,
        version: archiveVersion,
        storageUrl: `/api/lecture/${lecture.publicToken}/export?format=zip`,
        sha256: archiveSha256
      }, recordOwnerEmail);
    }

    return new Response(zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${lecture.publicToken}-${archiveVersion}.zip"`,
        "x-learnbuddy-export-version": archiveVersion,
        "x-learnbuddy-sha256": archiveSha256,
        "x-learnbuddy-manifest-sha256": sha256(archiveManifestJson)
      }
    });
  }

  if (recordOwnerEmail) {
    await repository.recordStandaloneExport({
      lectureId: lecture.id,
      version,
      storageUrl: `/api/lecture/${lecture.publicToken}/export`,
      sha256: responseSha256
    }, recordOwnerEmail);
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${lecture.publicToken}-${version}.html"`,
      "x-learnbuddy-export-version": version,
      "x-learnbuddy-sha256": responseSha256,
      "x-learnbuddy-manifest-sha256": manifestSha256
    }
  });
}
