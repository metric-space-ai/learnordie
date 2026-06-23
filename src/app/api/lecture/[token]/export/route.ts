import { notFound } from "next/navigation";
import crypto from "node:crypto";

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

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJsonForScript(input: string) {
  return input
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

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

function renderSlides(lecture: Lecture) {
  return lecture.slides
    .map((slide, index) => `
      <article class="slide" id="slide-${index + 1}" aria-labelledby="slide-${index + 1}-title">
        <p class="eyebrow">${escapeHtml(slide.eyebrow)}</p>
        <h3 id="slide-${index + 1}-title">${escapeHtml(slide.title)}</h3>
        ${slide.copy.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </article>`)
    .join("");
}

function renderQuestions(lecture: Lecture) {
  return lecture.questions
    .map((question, index) => `
      <article class="question" id="frage-${index + 1}" data-question aria-labelledby="frage-${index + 1}-title" aria-describedby="frage-${index + 1}-feedback frage-${index + 1}-explanation">
        <h3 id="frage-${index + 1}-title">Niveau ${escapeHtml(question.level)}</h3>
        <p>${escapeHtml(question.text)}</p>
        <div class="answers" role="group" aria-label="Antwortoptionen zu Frage ${index + 1}">
          ${question.answers.map((answer) => `<button type="button" data-answer data-correct="${answer.correct ? "true" : "false"}" aria-pressed="false" aria-disabled="false" aria-label="Antwort ${escapeHtml(answer.key)}: ${escapeHtml(answer.text)}"><span aria-hidden="true">${escapeHtml(answer.key)}</span>${escapeHtml(answer.text)}</button>`).join("")}
        </div>
        <p class="feedback" id="frage-${index + 1}-feedback" role="status" aria-live="polite" aria-atomic="true" tabindex="-1" data-feedback>Antwort wählen.</p>
        <p class="explanation" id="frage-${index + 1}-explanation"><strong>Erklärung:</strong> ${escapeHtml(question.explanation)}</p>
      </article>`)
    .join("");
}

function renderAudioBlock(audioAssets: AudioAsset[], inline: boolean) {
  return `
    <section class="audio-block" aria-label="Dozentenaudio">
      <strong>Dozentenaudio</strong>
      <span>${audioAssets.some((asset) => asset.source === "upload")
        ? "Dieser Export enthält die hinterlegte Audiospur des Dozenten."
        : "Dieser Export enthält einen eingebetteten Audio-Fallback. Echte Vorlesungsaudio-Dateien können später an derselben Manifeststelle ersetzt werden."}</span>
      ${audioAssets.map((asset) => {
        const src = inline
          ? `data:${asset.mediaType};base64,${asset.bytes.toString("base64")}`
          : asset.path;
        return `
          <figure>
            <figcaption>${escapeHtml(asset.originalName)} · ${escapeHtml(asset.sha256)}</figcaption>
            <audio controls preload="metadata" src="${src}"></audio>
          </figure>`;
      }).join("")}
    </section>`;
}

function standaloneStyles() {
  return `
    :root { color-scheme: light; --ink: #071722; --muted: #506675; --line: #b9cbd6; --panel: #fbfdfe; --soft: #edf5f8; --good: #d9f2e4; --bad: #ffe0dd; --accent: #c7881b; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #f6fafc; }
    main { min-height: 100vh; padding: clamp(20px, 5vw, 72px); }
    header { display: grid; gap: 18px; max-width: 1040px; }
    .skip-link { position: absolute; top: 12px; left: 12px; z-index: 10; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; border-radius: 8px; background: var(--ink); color: white; font-weight: 850; }
    .skip-link:focus { width: auto; height: auto; padding: 10px 12px; overflow: visible; clip: auto; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    h1 { max-width: 980px; margin: 0; font-size: clamp(36px, 7vw, 76px); line-height: 1.02; letter-spacing: 0; }
    h2 { margin: 0 0 16px; font-size: clamp(24px, 4vw, 42px); line-height: 1.08; }
    h3 { margin: 0 0 16px; font-size: clamp(22px, 3.5vw, 38px); line-height: 1.1; }
    .kicker, .eyebrow { margin: 0; color: var(--muted); font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
    .meta, .manifest, .audio-block, .slide, .question { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
    .meta, .manifest, .audio-block { display: grid; gap: 8px; max-width: 980px; padding: 14px 16px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
    .meta strong, .manifest strong, .audio-block strong { color: var(--ink); }
    audio { width: min(100%, 560px); }
    section { display: grid; gap: 18px; max-width: 1040px; margin-top: 36px; }
    .slide, .question { padding: clamp(18px, 3vw, 32px); }
    .slide p, .question p { max-width: 780px; font-size: clamp(17px, 2.4vw, 22px); line-height: 1.45; }
    .answers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
    button { min-height: 56px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: #dceaf1; color: var(--ink); font: inherit; font-weight: 760; text-align: left; cursor: pointer; }
    button:focus-visible, audio:focus-visible, .skip-link:focus-visible { outline: 4px solid #1e6b9a; outline-offset: 3px; }
    button span { display: inline-grid; place-items: center; width: 30px; height: 30px; margin-right: 10px; border-radius: 999px; background: rgba(255,255,255,0.74); color: var(--muted); font-weight: 900; }
    button[aria-disabled="true"] { cursor: default; }
    button.correct { border-color: #7eba95; background: var(--good); }
    button.incorrect { border-color: #e6958d; background: var(--bad); }
    .feedback { min-height: 28px; margin: 14px 0 0; color: var(--muted); font-weight: 850; }
    .explanation { color: var(--muted); }
    .manifest ul { margin: 0; padding-left: 18px; }
    @media (max-width: 700px) {
      main { padding: 16px; }
      .answers { grid-template-columns: 1fr; }
      button { min-height: 52px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; }
    }
  `.trim();
}

function standaloneScript() {
  return `
    (() => {
      function moveAnswerFocus(button, direction) {
        const answers = Array.from(button.closest("[data-question]").querySelectorAll("[data-answer]"));
        const currentIndex = answers.indexOf(button);
        if (currentIndex < 0) return;
        const nextIndex = direction === "first"
          ? 0
          : direction === "last"
            ? answers.length - 1
            : (currentIndex + direction + answers.length) % answers.length;
        answers[nextIndex].focus();
      }

      document.querySelectorAll("[data-question]").forEach((question) => {
        question.addEventListener("keydown", (event) => {
          const button = event.target.closest("[data-answer]");
          if (!button || !question.contains(button)) return;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            moveAnswerFocus(button, 1);
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            moveAnswerFocus(button, -1);
          }
          if (event.key === "Home") {
            event.preventDefault();
            moveAnswerFocus(button, "first");
          }
          if (event.key === "End") {
            event.preventDefault();
            moveAnswerFocus(button, "last");
          }
        });

        question.addEventListener("click", (event) => {
          const button = event.target.closest("[data-answer]");
          if (!button || !question.contains(button)) return;
          if (question.dataset.answered === "true") return;
          question.dataset.answered = "true";
          const isCorrect = button.dataset.correct === "true";
          question.querySelectorAll("[data-answer]").forEach((answer) => {
            answer.classList.toggle("correct", answer.dataset.correct === "true");
            answer.classList.toggle("incorrect", answer === button && !isCorrect);
            answer.setAttribute("aria-disabled", "true");
            answer.setAttribute("aria-pressed", answer === button ? "true" : "false");
          });
          const feedback = question.querySelector("[data-feedback]");
          if (feedback) {
            feedback.textContent = isCorrect ? "Richtig." : "Nicht korrekt. Die richtige Antwort ist grün markiert.";
            feedback.focus({ preventScroll: true });
          }
        });
      });
    })();
  `.trim();
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
  const styles = standaloneStyles();
  const script = standaloneScript();
  const canonicalPayload = {
    export: {
      version,
      schemaVersion: EXPORT_SCHEMA_VERSION,
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

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(lecture.seriesTitle)} - ${escapeHtml(lecture.title)}</title>
  <style>${styles}</style>
</head>
<body>
  <a class="skip-link" href="#slides">Zum Folieninhalt springen</a>
  <main id="inhalt" aria-labelledby="export-title">
    <header>
      <p class="kicker">${escapeHtml(lecture.seriesTitle)}</p>
      <h1 id="export-title">${escapeHtml(lecture.title)}</h1>
    </header>
    <section class="meta" aria-label="Export-Metadaten">
      <strong>Standalone Export ${escapeHtml(version)}</strong>
      <span>Exportiert: ${escapeHtml(exportedAt)}</span>
      <span>Payload SHA-256: ${payloadSha256}</span>
      <span>Manifest SHA-256: ${manifestSha256}</span>
      <span>Self-contained: ja, externe Assets: 0</span>
      <span>Server-KI, Analytics und Synchronisation sind in diesem Offline-Export nicht enthalten.</span>
    </section>
    ${renderAudioBlock(audioAssets, true)}
    <section class="manifest" aria-label="Offline-Manifest">
      <strong>Offline-Manifest</strong>
      <span>Alle Asset-Prüfsummen sind im HTML eingebettet.</span>
      <ul>
        ${assets.map((asset) => `<li>${escapeHtml(asset.path)} · ${escapeHtml(asset.sha256)}</li>`).join("")}
      </ul>
    </section>
    <section id="slides" aria-labelledby="slides-title">
      <h2 id="slides-title" class="sr-only">Folien</h2>
      ${renderSlides(lecture)}
    </section>
    <section id="questions" aria-labelledby="questions-title">
      <h2 id="questions-title">Eingebettete Fragen</h2>
      ${renderQuestions(lecture)}
    </section>
  </main>
  <script type="application/json" id="learnbuddy-data">${escapeJsonForScript(data)}</script>
  <script type="application/json" id="learnbuddy-manifest">${escapeJsonForScript(manifestJson)}</script>
  <script>${script}</script>
</body>
</html>`;
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
