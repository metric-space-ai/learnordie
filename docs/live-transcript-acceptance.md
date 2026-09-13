# Live transcript release acceptance

Status: implementation in progress; **not production accepted**.

## Provider and behavior

- MiniMax ASR `asr-1.0`, `POST https://api.minimax.io/v1/speech_to_text`, multipart WAV, German language hint. This is separate from MiniMax M3 question generation.
- Official contract: https://platform.minimax.io/docs/api-reference/speech-to-text.md (checked 2026-09-13).
- Microphone activation starts continuous PCM capture; ASR requests consume a bounded queue independently, without stopping capture between requests.
- Stop flushes the final partial passage. Navigation stops capture and cancels pending ASR. Errors/backlog saturation stop recording with an explicit failure, not a healthy indicator.
- Accepted transcription is persisted even when automatic question generation is disabled.
- Tiny always-visible indicator: off, awaiting transcription, recent accepted speech, failure. Green requires a recent accepted passage, not merely microphone permission.
- `L` requests `mode: "transcript-only"`; recent speech selects the topic. No current transcript means no slide fallback. Space keeps its separate slide-capable behavior.
- Server integration for transcript-only context, lecture script/history and student-question ticker is a separate pending worker package.

## Required release evidence (still open)

1. Play a known German lecture audio file into real browser capture. Verify nonempty MiniMax transcription and expected topic, not a mock response or prerecorded transcript injection.
2. Verify continuous capture while delaying ASR responses, passage order, timestamps and persistence after reload.
3. Verify microphone denial, stop/restart, lost device, timeout and queue saturation; indicator must reflect failure/staleness.
4. Press `L` after speech on a topic different from the visible slide. Verify four difficulty levels, four options each and authoritative 60-second publication while the lecturer continues navigating.
5. `L` without recent speech must fail clearly without silently generating from the slide or a previous session's transcript.
6. Verify original lecture material and accumulated accepted transcript in generation grounding, with the latest topic taking precedence.
7. Verify teacher plus three independent students, answer cutoff and scoring, no answer-key leakage.

PCM segmentation tests and adapter tests are supporting evidence only; they do not establish an actual microphone/audio-player-to-MiniMax-to-live-question pass.
