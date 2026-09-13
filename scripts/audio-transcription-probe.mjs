#!/usr/bin/env node
// Synthetic audio only. Run with production credentials kept inside Vercel.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

if (process.argv.includes("--help")) {
  console.log("Usage: audio-transcription-probe.mjs --validate-fixture | --run\nTests a pinned synthetic German WAV through the configured MiniMax ASR adapter, then the transcript-only question generator. No database writes. This is not a microphone/browser acceptance test.");
  process.exit(0);
}
const validateOnly = process.argv.includes("--validate-fixture");
if (!validateOnly && (!process.argv.includes("--run") || process.env.VERCEL_ENV !== "production")) {
  console.error("Use --validate-fixture locally or explicit --run inside Vercel production.");
  process.exit(1);
}

const bytes = await readFile(new URL("../tests/fixtures/audio/spring-de.wav", import.meta.url));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const report = { test: "synthetic-german-audio-to-transcript-to-question-family", fixture: { sha256, bytes: bytes.length }, browserTested: false, microphoneTested: false, databaseWrites: false };
let phase = "fixture";
let httpStatus = null;
let endpointOrigin = null;
const originalFetch = globalThis.fetch;
try {
  // Pinning prevents accidental upload of private recordings when running this probe.
  if (sha256 !== "6b1d090bc7ce85e56df6d08e4eeeb91c7e4bf7b4b7b00982ab460a873eda3607") throw new Error("fixture-mismatch");
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("invalid-wav");
  let format, dataBytes;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) throw new Error("invalid-wav");
    if (kind === "fmt " && size >= 16) format = { pcm: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10), sampleRate: bytes.readUInt32LE(offset + 12), bits: bytes.readUInt16LE(offset + 22) };
    if (kind === "data") dataBytes = size;
    offset += 8 + size + (size % 2);
  }
  if (format?.pcm !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bits !== 16 || !(dataBytes > 0)) throw new Error("invalid-wav");
  report.fixture = { ...report.fixture, ...format, durationSeconds: dataBytes / 32000 };
  if (!validateOnly) {
    globalThis.fetch = async (...args) => {
      const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
      if (!["api.minimax.io", "llm.learnordie.app"].includes(url.hostname) || url.protocol !== "https:") throw new Error("unexpected-endpoint");
      endpointOrigin = url.origin;
      const response = await originalFetch(...args);
      httpStatus = response.status;
      return response;
    };
    phase = "asr";
    const { getSTTProvider } = await import("@/server/providers/stt");
    const stt = getSTTProvider();
    if (stt.name !== "minimax-asr-1.0") throw new Error("unexpected-asr-provider");
    const started = Date.now();
    const transcript = await stt.transcribeAudio({ audio: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mimeType: "audio/wav", lectureTitle: "Audioabnahme", language: "de" });
    // No expected wording is sent to ASR; recognition must come from the audio.
    const recognized = transcript.text.toLocaleLowerCase("de");
    const concepts = ["masse", "feder", "weicher", "unten", "schwingung", "langsamer"];
    const missing = concepts.filter(word => !recognized.includes(word));
    report.asr = { provider: transcript.provider, elapsedMs: Date.now() - started, httpStatus, endpointOrigin, transcript: transcript.text, missingConcepts: missing };
    if (missing.length) throw new Error("audio-content-mismatch");
    phase = "transcript-question-family";
    const { getAIProvider } = await import("@/server/providers/ai");
    const ai = getAIProvider();
    if (ai.info.model.toLowerCase() !== "minimax-m3") throw new Error("unexpected-model");
    const { generateLiveQuestionFamily } = await import("@/server/question-generation");
    const { demoLecture } = await import("@/lib/demo-data");
    report.generationAttempts = [];
    const observedProvider = Object.create(ai);
    observedProvider.complete = async input => {
      const result = await ai.complete(input);
      let parsed;
      try { parsed = JSON.parse(result.answer); } catch { /* Keep diagnostics structural, never raw provider errors. */ }
      report.generationAttempts.push({ answerChars: result.answer.length, validJson: Boolean(parsed), variants: Array.isArray(parsed?.variants) ? parsed.variants.map(variant => ({ level: variant.level, textChars: variant.text?.length, answerCount: variant.answers?.length, explanationChars: variant.explanation?.length })) : null });
      return result;
    };
    const family = await generateLiveQuestionFamily({ lecture: { ...demoLecture, title: "Audioabnahme", seriesTitle: "Synthetische Audioabnahme", questions: [], transcriptSegments: [] }, slide: { title: "Audioabnahme", lines: [] }, transcript: transcript.text, latestTranscript: transcript.text, scriptContext: "", existingQuestionTexts: [], contextSource: "transcript", transcriptOnly: true }, observedProvider);
    if (family.length !== 4 || family.some(variant => variant.answers.length !== 4 || variant.answers.filter(answer => answer.correct).length !== 1)) throw new Error("invalid-family");
    report.questions = { model: "MiniMax-M3", variants: family.length, answersPerVariant: family.map(variant => variant.answers.length), httpStatus, endpointOrigin, transcriptOnly: true };
  }
  report.status = "pass";
} catch (error) {
  const safeErrors = ["fixture-mismatch", "invalid-wav", "unexpected-endpoint", "unexpected-asr-provider", "audio-content-mismatch", "unexpected-model", "invalid-family", "MiniMax ASR request timed out.", "MiniMax ASR response contained no transcript text.", "MiniMax ASR response contained an invalid audio duration."];
  report.status = "fail";
  const structuralValidation = /^(Live question generator (must return|returned|omitted)|Draft generator returned)/.test(error?.message ?? "");
  report.failure = { phase, httpStatus, endpointOrigin, reason: safeErrors.includes(error?.message) || structuralValidation ? error.message : "adapter-failure-see-http-status" };
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify(report, null, 2));
