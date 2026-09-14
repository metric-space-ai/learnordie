export type TranscriptionPhase = "idle" | "requesting" | "listening" | "transcribing" | "ready" | "error";

/** A requested permission is not a running microphone or a confirmed transcript. */
export function transcriptRecordingStatus(input: {
  phase: TranscriptionPhase;
  listening: boolean;
  pending: number;
  lastTranscriptAt: number;
  now: number;
}): { state: "error" | "pending" | "confirmed" | "off"; label: string } {
  if (input.phase === "error") return { state: "error", label: "Live-Transkript: Fehler" };
  if (input.phase === "requesting") return { state: "pending", label: "Live-Transkript: Mikrofonfreigabe ausstehend" };
  if (!input.listening) return input.pending > 0
    ? { state: "pending", label: "Live-Transkript: letzte Passage wird verarbeitet" }
    : { state: "off", label: "Live-Transkript: aus" };
  const age = input.now - input.lastTranscriptAt;
  return input.lastTranscriptAt > 0 && age >= 0 && age < 30_000
    ? { state: "confirmed", label: "Live-Transkript: aktueller Text bestätigt" }
    : { state: "pending", label: "Live-Transkript: Aufnahme läuft, Bestätigung ausstehend" };
}
