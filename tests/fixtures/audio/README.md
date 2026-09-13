# Synthetic German ASR fixture

`spring-de.wav` contains no personal data or production lecture recording. It was
generated locally using macOS `say`, Anna, rate 150, mono PCM16 WAV at 16 kHz:

> Eine Masse hängt an einer Feder. Wenn die Feder weicher wird, hängt die Masse
> weiter nach unten. Die Schwingung wird langsamer.

The release probe pins its SHA-256 before any external upload and passes no
expected words to ASR. It checks recognition of the physical concepts, then feeds
only the recognized transcript into the actual transcript-only MiniMax M3 question
generator. It neither writes lecture data nor certifies the microphone, browser,
session persistence, keyboard shortcut or student delivery path.

Local validation:
`node scripts/audio-transcription-probe.mjs --validate-fixture`

Real provider test (inside Vercel, credentials stay there):
`node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/audio-transcription-probe.mjs --run`
