import assert from "node:assert/strict";
import { test } from "node:test";
import { createPcmSegmenter, encodePcm16Wav } from "@/lib/audio-capture";

test("continuous PCM capture preserves every sample across arbitrary browser callbacks", () => {
  const segments: number[][] = [];
  const segmenter = createPcmSegmenter(5, samples => segments.push([...samples]));
  segmenter.push(Float32Array.from([0, 1, 2]));
  segmenter.push(Float32Array.from([3, 4, 5, 6, 7, 8, 9, 10, 11]));
  segmenter.push(Float32Array.from([12, 13, 14, 15]));
  assert.deepEqual(segments, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14]]);
  segmenter.flush();
  segmenter.flush();
  assert.deepEqual(segments.flat(), Array.from({ length: 16 }, (_, i) => i));
});

test("PCM capture continues while earlier segments await transcription", async () => {
  const queue: Float32Array[] = [];
  const segmenter = createPcmSegmenter(4096, samples => queue.push(samples));
  // Twelve segments can be produced without waiting on any provider request.
  for (let i = 0; i < 12; i++) segmenter.push(new Float32Array(4096).fill(i / 12));
  assert.equal(queue.length, 12);
  const audio = encodePcm16Wav(queue[0], 48000);
  const view = new DataView(await audio.arrayBuffer());
  assert.equal(audio.type, "audio/wav");
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 8192);
  assert.equal(view.byteLength, 8236);
});

test("invalid chunk sizes fail instead of hanging audio capture", () => {
  for (const size of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => createPcmSegmenter(size, () => undefined));
  }
});
