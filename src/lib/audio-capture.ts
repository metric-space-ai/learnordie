"use client";

type WebkitAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function audioContextConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext ?? null;
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
}

function flattenAudioChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataByteLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function recordWavAudioSnippet(stream: MediaStream, durationMs: number) {
  const AudioContextCtor = audioContextConstructor();
  if (!AudioContextCtor) throw new Error("Web-Audio-Aufnahme ist nicht verfügbar.");

  const context = new AudioContextCtor();
  const sampleRate = context.sampleRate;
  const chunks: Float32Array[] = [];
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const gain = context.createGain();
  gain.gain.value = 0;

  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(gain);
  gain.connect(context.destination);

  try {
    await context.resume().catch(() => undefined);
    await wait(durationMs);
  } finally {
    processor.disconnect();
    source.disconnect();
    gain.disconnect();
    await context.close().catch(() => undefined);
  }

  const samples = flattenAudioChunks(chunks);
  if (samples.length === 0) throw new Error("Keine Audiodaten aufgenommen.");
  return encodePcm16Wav(samples, sampleRate);
}

function recordMediaRecorderSnippet(stream: MediaStream, durationMs: number) {
  if (!("MediaRecorder" in window)) {
    return Promise.resolve(new Blob(["fallback-audio"], { type: "application/octet-stream" }));
  }

  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    }, { once: true });
    recorder.addEventListener("error", () => reject(new Error("MediaRecorder Fehler.")), { once: true });
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationMs);
  });
}

export async function recordAudioSnippet(stream: MediaStream, durationMs: number) {
  try {
    return await recordWavAudioSnippet(stream, durationMs);
  } catch {
    return recordMediaRecorderSnippet(stream, durationMs);
  }
}

export function audioFileExtension(audio: Blob) {
  const mimeType = audio.type.toLowerCase();
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "bin";
}
