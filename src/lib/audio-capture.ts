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

export async function recordAudioSnippet(stream: MediaStream, durationMs: number) {
  // Never substitute fake bytes or unsupported WebM for a failed recording.
  return recordWavAudioSnippet(stream, durationMs);
}

/** Fixed sample boundaries: neither gaps nor duplicated samples between requests. */
export function createPcmSegmenter(sampleCount: number, emit: (samples: Float32Array) => void) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) throw new Error("Invalid audio segment size.");
  let buffer = new Float32Array(sampleCount);
  let used = 0;
  return {
    push(samples: Float32Array) {
      let offset = 0;
      while (offset < samples.length) {
        const size = Math.min(sampleCount - used, samples.length - offset);
        buffer.set(samples.subarray(offset, offset + size), used);
        offset += size;
        used += size;
        if (used === sampleCount) {
          const complete = buffer;
          buffer = new Float32Array(sampleCount);
          used = 0;
          emit(complete);
        }
      }
    },
    flush() {
      if (!used) return;
      const remaining = buffer.slice(0, used);
      used = 0;
      emit(remaining);
    }
  };
}

export type RecordedPassage = { audio: Blob; startedAt: string; endedAt: string };

/** One audio graph stays active while a separate bounded queue performs ASR. */
export async function startContinuousWavCapture(stream: MediaStream, durationMs: number,
  onPassage: (passage: RecordedPassage) => void, onError: (error: Error) => void) {
  const AudioContextCtor = audioContextConstructor();
  if (!AudioContextCtor) throw new Error("Web-Audio-Aufnahme ist nicht verfügbar.");
  const context = new AudioContextCtor();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const gain = context.createGain();
  gain.gain.value = 0;
  let stopped = false;
  let samplesRecorded = 0;
  let started = Date.now();
  const segmenter = createPcmSegmenter(Math.round(context.sampleRate * durationMs / 1000), samples => {
    const startedAt = new Date(started + samplesRecorded / context.sampleRate * 1000).toISOString();
    samplesRecorded += samples.length;
    onPassage({ audio: encodePcm16Wav(samples, context.sampleRate), startedAt,
      endedAt: new Date(started + samplesRecorded / context.sampleRate * 1000).toISOString() });
  });
  processor.onaudioprocess = event => {
    if (!stopped) segmenter.push(event.inputBuffer.getChannelData(0));
  };
  const onEnded = () => onError(new Error("Mikrofonverbindung unterbrochen."));
  const onState = () => {
    if (!stopped && context.state !== "running") onError(new Error("Audioaufnahme wurde vom Browser unterbrochen."));
  };
  const stop = async (flush = true) => {
    if (stopped) return;
    stopped = true;
    context.removeEventListener("statechange", onState);
    stream.getAudioTracks().forEach(track => track.removeEventListener("ended", onEnded));
    processor.onaudioprocess = null;
    processor.disconnect(); source.disconnect(); gain.disconnect();
    if (flush) segmenter.flush();
    await context.close().catch(() => undefined);
  };
  try {
    source.connect(processor); processor.connect(gain); gain.connect(context.destination);
    await context.resume();
    if (context.state !== "running") throw new Error("Audioaufnahme konnte nicht gestartet werden.");
    started = Date.now();
    context.addEventListener("statechange", onState);
    stream.getAudioTracks().forEach(track => track.addEventListener("ended", onEnded, { once: true }));
    return { stop };
  } catch (error) {
    await stop(false);
    throw error;
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
