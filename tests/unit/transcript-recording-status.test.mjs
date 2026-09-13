import test from "node:test";
import assert from "node:assert/strict";
import { transcriptRecordingStatus } from "../../src/lib/transcript-recording-status.ts";

const idle = { phase: "idle", listening: false, pending: 0, lastTranscriptAt: 0, now: 100_000 };

test("pending microphone permission is not reported as off or recording", () => {
  assert.deepEqual(transcriptRecordingStatus({ ...idle, phase: "requesting" }), {
    state: "pending", label: "Live-Transkript: Mikrofonfreigabe ausstehend"
  });
  assert.equal(transcriptRecordingStatus(idle).state, "off");
});
test("only recently acknowledged audio confirms the indicator", () => {
  for (const lastTranscriptAt of [0, 69_999, 70_000, 100_001]) {
    assert.equal(transcriptRecordingStatus({ ...idle, phase: "listening", listening: true, lastTranscriptAt }).state, "pending");
  }
  assert.equal(transcriptRecordingStatus({ ...idle, phase: "ready", listening: true, lastTranscriptAt: 90_000 }).state, "confirmed");
});
test("stopped microphone can still drain its last passage without claiming to record", () => {
  assert.deepEqual(transcriptRecordingStatus({ ...idle, pending: 1, lastTranscriptAt: 99_000 }), {
    state: "pending", label: "Live-Transkript: letzte Passage wird verarbeitet"
  });
});
test("an error takes precedence over pending or recently confirmed text", () => {
  assert.deepEqual(transcriptRecordingStatus({ ...idle, phase: "error", listening: true, pending: 1, lastTranscriptAt: 99_000 }), {
    state: "error", label: "Live-Transkript: Fehler"
  });
});
