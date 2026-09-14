# Live transcript release acceptance

Status: implementation in progress; **not production accepted**.

## Provider and behavior

- MiniMax ASR `asr-1.0`, `POST https://api.minimax.io/v1/speech_to_text`, multipart WAV, German language hint. This is separate from MiniMax M3 question generation.
- Official contract: https://platform.minimax.io/docs/api-reference/speech-to-text.md (checked 2026-09-13).
- Microphone activation starts continuous PCM capture; ASR requests consume a bounded queue independently, without stopping capture between requests.
- Stop flushes the final partial passage. Navigation stops capture and cancels pending ASR. Errors/backlog saturation stop recording with an explicit failure, not a healthy indicator.
- Accepted transcription is persisted even when automatic question generation is disabled.
- Tiny always-visible indicator: off, awaiting transcription, recent accepted speech, failure. Green requires a recent accepted passage, not merely microphone permission.
- `Shift+Space` requests `mode: "transcript-only"`; recent speech selects the topic. No current transcript means no slide fallback. Plain `Space` publishes a prepared four-level family for the current slide, without invoking the model. `L` is not a question shortcut.
- Server integration includes the current-session transcript, lecture manuscript, other slides and the student-question ticker. A generated family requires independent source/answer review before publication. Implementation and mocked integration evidence do not establish real-provider acceptance.

## Required release evidence (still open)

1. Play a known German lecture audio file into real browser capture. Verify nonempty MiniMax transcription and expected topic, not a mock response or prerecorded transcript injection.
2. Verify continuous capture while delaying ASR responses, passage order, timestamps and persistence after reload.
3. Verify microphone denial, stop/restart, lost device, timeout and queue saturation; indicator must reflect failure/staleness.
4. Press `Shift+Space` after speech on a topic different from the visible slide. Verify four difficulty levels, four options each and authoritative 60-second publication while the lecturer continues navigating.
5. `Shift+Space` without recent speech must fail clearly without silently generating from the slide or a previous session's transcript.
6. Verify original lecture material and accumulated accepted transcript in generation grounding, with the latest topic taking precedence.
7. Verify teacher plus three independent students, answer cutoff and scoring, no answer-key leakage.

PCM segmentation tests and adapter tests are supporting evidence only; they do not establish an actual microphone/audio-player-to-MiniMax-to-live-question pass.

## Evidence as of 2026-09-14

- CI run `34805233741`, source `bb6f965`: the real browser capture path used a synthetic audio stream, exercised multipart ASR upload, persisted the mocked transcription through the actual transcript endpoint, and triggered `Shift+Space`. The teacher navigated during generation; three isolated students received the 60-second round. The ASR and model responses were deterministic fixtures, so this proves integration and recovery behavior, not real transcription or model quality.
- The same run passed the separate multi-student live flow covering late join, answer receipts, scoring, cutoff, reconnect and end. Production DT-01 with prepared Space questions was separately checked on source `728db68`; its eight original slides and question corpus remain unchanged.
- Real MiniMax generation against the complete repository model manuscript and synthetic speech remains unaccepted. Diagnostic `dpl_75eZE8ALyzMkg6kTQwDcra1zNjeN` produced source-dependent question wording. After actionable source-reference feedback, `dpl_DG6bSeYT9MNwDmUr6RmbbhtEYb9b` reached review but failed because of unrelated distractors. After separating the fixed repair task from untrusted feedback/context, `dpl_ECtBK3ofP2iTEK2mJCpdnKkRSKED` failed the 240-character question limit (255 characters). No family was published; no diagnostic deployment changed the live alias or database.
- CI `34806106239`, source `a23f4a2`: 114 broad browser tests passed, three skipped, one failed due to obsolete body-supplied participant identity/rate-limit expectations. The test now checks the signed-session identity and that changing a body key cannot bypass the limit. This correction requires the next CI run; the failure is not claimed as passed.
- Current focused generation/reviewer contracts: 70 passed and typecheck passed. Repair feedback is kept as data; fixed repair instructions are separate. Short, actual source passages may be cited by their validated IDs. No factual/distractor quality check was removed.

## Adaptive reasoning candidate (not promoted)

- CI `34807085752` on `d0f5439` completed successfully, including the corrected signed-session identity/rate-limit journey. This is separate from the subsequent reasoning candidate and does not prove real-provider quality.
- Structural repair now receives errors from every affected difficulty instead of stopping at the first level. The regression assertion was observed failing before this change and passing afterwards.
- The previous adapters explicitly disabled MiniMax M3 reasoning. [MiniMax's Responses contract](https://platform.minimax.io/docs/api-reference/responses-create) documents that `none` disables reasoning and non-`none` enables adaptive reasoning; the effort names do not select different reasoning depths.
- Exam authoring and independent review now request `minimal` (adaptive), with an 8192-token shared reasoning/answer allowance. Other calls retain `none`. Only final answer text is parsed/returned. Both direct MiniMax and the Responses adapter are covered by transport tests.
- Real diagnostic `dpl_6R8Bf1zvDgDiRwURQtve9MHeNXND` without reasoning still failed independent answer/distractor checks. The first adaptive diagnostic, `dpl_4jDiVxVkb2BAj9A8Xmh2gZJD7YcZ`, timed out after 25005 ms before an answer. Author/reviewer single-call caps are now 45/40 seconds within the unchanged caller deadline (live total 120 seconds); the student answer clock remains independent. This candidate still needs a real passing run and browser acceptance.
- 34 focused author/reviewer/transport tests pass, including bounded deadline behavior, multi-level feedback, separated reasoning output and unchanged defaults. They are not real-provider acceptance.
