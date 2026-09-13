import assert from "node:assert/strict";
import test from "node:test";
import { getOCRProvider } from "@/server/providers/ocr";
import { getSTTProvider } from "@/server/providers/stt";

const ENV_KEYS = [
  "LEARNBUDDY_DEPLOYMENT_ENV",
  "LEARNORDIE_MINIMAX_API_KEY",
  "MINIMAX_API_KEY",
  "LEARNBUDDY_OCR_PROVIDER",
  "LEARNBUDDY_OCR_MODEL",
  "LEARNBUDDY_OCR_BASE_URL",
  "LEARNBUDDY_OCR_API_KEY",
  "LEARNBUDDY_OCR_LANGUAGE",
  "LEARNBUDDY_OCR_TIMEOUT_MS",
  "LEARNBUDDY_STT_PROVIDER",
  "LEARNBUDDY_STT_MODEL",
  "LEARNBUDDY_STT_BASE_URL",
  "LEARNBUDDY_STT_API_KEY",
  "LEARNBUDDY_STT_LANGUAGE",
  "LEARNBUDDY_STT_TIMEOUT_MS",
  "MISTRAL_API_KEY"
] as const;

test("MiniMax media adapters send bounded M3 vision and asr-1.0 requests without other provider fallbacks", async (t) => {
  const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.LEARNBUDDY_DEPLOYMENT_ENV = "local";
  process.env.LEARNORDIE_MINIMAX_API_KEY = "minimax-test-token";
  delete process.env.MINIMAX_API_KEY;
  process.env.LEARNBUDDY_OCR_PROVIDER = "minimax";
  delete process.env.LEARNBUDDY_OCR_MODEL;
  process.env.LEARNBUDDY_OCR_BASE_URL = "https://api.openai.com/v1/chat/completions";
  process.env.LEARNBUDDY_OCR_API_KEY = "must-not-be-used";
  process.env.LEARNBUDDY_OCR_LANGUAGE = "de";
  process.env.LEARNBUDDY_OCR_TIMEOUT_MS = "1000";

  const ocrRequests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    ocrRequests.push({ url: String(input), init, body });
    return Response.json({ choices: [{ message: { content: `OCR batch ${ocrRequests.length}` } }] });
  };

  const ocr = getOCRProvider();
  assert.equal(ocr.name, "minimax-m3-vision");
  const ocrResult = await ocr.extractText({
    fileName: "slide.png",
    mimeType: "image/png",
    images: Array.from({ length: 10 }, (_, index) => ({
      name: `slide-${index + 1}.png`,
      mimeType: "image/png",
      bytes: Buffer.from(`png test bytes ${index + 1}`)
    }))
  });
  assert.equal(ocrResult.text, "OCR batch 1\n\nOCR batch 2");
  assert.equal(ocrResult.model, "MiniMax-M3");
  assert.equal(ocrResult.confidence, undefined);
  assert.equal(ocrRequests.length, 2, "all images are submitted in bounded batches");
  assert.equal(ocrRequests[0].url, "https://api.minimax.io/v1/chat/completions");
  assert.equal((ocrRequests[0].init.headers as Record<string, string>).authorization, "Bearer minimax-test-token");
  const ocrBody = ocrRequests[0].body;
  assert.equal(ocrBody.model, "MiniMax-M3");
  assert.deepEqual(ocrBody.thinking, { type: "disabled" });
  assert.equal(ocrBody.reasoning_split, true);
  assert.equal(ocrBody.max_completion_tokens, 2048);
  const messages = ocrBody.messages as Array<{ role: string; content: unknown }>;
  const content = messages[1].content as Array<{ type: string; image_url?: { url: string; detail: string } }>;
  assert.equal(content.length - 1, 8, "each MiniMax request is limited to eight images");
  assert.equal(content[1].type, "image_url");
  assert.equal(content[1].image_url?.url, `data:image/png;base64,${Buffer.from("png test bytes 1").toString("base64")}`);
  assert.equal(content[1].image_url?.detail, "high");
  const secondBatchMessages = ocrRequests[1].body.messages as Array<{ role: string; content: unknown }>;
  const secondBatchContent = secondBatchMessages[1].content as Array<{ type: string; image_url?: { url: string } }>;
  assert.equal(secondBatchContent.length - 1, 2);
  assert.equal(secondBatchContent[2].image_url?.url, `data:image/png;base64,${Buffer.from("png test bytes 10").toString("base64")}`);

  let ocrCalls = 0;
  globalThis.fetch = async () => {
    ocrCalls += 1;
    return Response.json({ error: { message: "rate limit" } }, { status: 429 });
  };
  await assert.rejects(ocr.extractText({
    fileName: "slide.png",
    mimeType: "image/png",
    images: [{ name: "slide.png", mimeType: "image/png", bytes: Buffer.from("png") }]
  }), /MiniMax M3 OCR request failed: rate limit/);
  await assert.rejects(ocr.extractText({
    fileName: "slide.bmp",
    mimeType: "image/bmp",
    images: [{ name: "slide.bmp", mimeType: "image/bmp", bytes: Buffer.from("bmp") }]
  }), /does not support image type image\/bmp/);
  assert.equal(ocrCalls, 1, "invalid media is rejected before a provider request");
  delete process.env.LEARNORDIE_MINIMAX_API_KEY;
  assert.throws(() => getOCRProvider(), /LEARNORDIE_MINIMAX_API_KEY or MINIMAX_API_KEY is required/);
  process.env.LEARNORDIE_MINIMAX_API_KEY = "minimax-test-token";
  process.env.LEARNBUDDY_OCR_MODEL = "gpt-4o-mini";
  assert.throws(() => getOCRProvider(), /must be MiniMax-M3/);

  process.env.LEARNBUDDY_STT_PROVIDER = "minimax";
  delete process.env.LEARNBUDDY_STT_MODEL;
  process.env.LEARNBUDDY_STT_BASE_URL = "https://api.openai.com/v1/audio/transcriptions";
  process.env.LEARNBUDDY_STT_API_KEY = "must-not-be-used";
  process.env.MISTRAL_API_KEY = "must-not-be-used-either";
  process.env.LEARNORDIE_MINIMAX_API_KEY = "replace-with-a-real-key";
  process.env.MINIMAX_API_KEY = "minimax-alias-token";
  process.env.LEARNBUDDY_STT_LANGUAGE = "de-DE";
  process.env.LEARNBUDDY_STT_TIMEOUT_MS = "1000";

  let sttRequest: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init = {}) => {
    sttRequest = { url: String(input), init };
    return Response.json({ text: "Die Stribeck-Kurve.", duration: 2.5 });
  };
  const stt = getSTTProvider();
  assert.equal(stt.name, "minimax-asr-1.0");
  const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;
  const sttResult = await stt.transcribeAudio({
    audio,
    mimeType: "audio/wav; codecs=1",
    lectureTitle: "Test lecture",
    language: "en"
  });
  assert.equal(sttResult.text, "Die Stribeck-Kurve.");
  assert.equal(sttResult.provider, "minimax-asr-1.0");
  assert.equal(sttResult.confidence, undefined);
  assert.equal(sttRequest?.url, "https://api.minimax.io/v1/speech_to_text");
  const headers = sttRequest?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer minimax-alias-token");
  assert.equal(headers.language, "de");
  assert.equal(headers["content-type"], undefined, "fetch supplies the multipart boundary");
  const formData = sttRequest?.init.body as FormData;
  assert.equal(formData.get("model"), "asr-1.0");
  assert.equal(formData.get("response_format"), "json");
  assert.equal(formData.get("language"), null, "MiniMax receives language in its header");
  const audioFile = formData.get("file");
  assert.ok(audioFile instanceof File);
  assert.equal(audioFile.name, "lecture-audio.wav");
  assert.equal(audioFile.type, "audio/wav");
  assert.deepEqual(new Uint8Array(await audioFile.arrayBuffer()), new Uint8Array([0x52, 0x49, 0x46, 0x46]));

  globalThis.fetch = async () => Response.json({ text: "  ", duration: 6.5 });
  const silence = await stt.transcribeAudio({ audio, mimeType: "audio/wav", lectureTitle: "Test lecture" });
  assert.equal(silence.text, "", "a speech pause must not terminate continuous transcription");
  globalThis.fetch = async () => Response.json({ text: "Die nächste Passage.", duration: 6.5 });
  assert.equal((await stt.transcribeAudio({ audio, mimeType: "audio/wav", lectureTitle: "Test lecture" })).text,
    "Die nächste Passage.", "speech resumes after a silent passage without changing providers");
  for (const malformed of [{ duration: 6.5 }, { text: null, duration: 6.5 }, { text: "", duration: -1 }]) {
    globalThis.fetch = async () => Response.json(malformed);
    await assert.rejects(stt.transcribeAudio({ audio, mimeType: "audio/wav", lectureTitle: "Test lecture" }),
      /MiniMax ASR response contained/);
  }

  let sttCalls = 0;
  globalThis.fetch = async () => {
    sttCalls += 1;
    return Response.json({ error: { message: "audio too large" } }, { status: 413 });
  };
  await assert.rejects(stt.transcribeAudio({
    audio,
    mimeType: "audio/wav",
    lectureTitle: "Test lecture"
  }), /MiniMax ASR request failed \(HTTP 413\): audio too large/);
  await assert.rejects(stt.transcribeAudio({
    audio,
    mimeType: "audio/webm",
    lectureTitle: "Test lecture"
  }), /does not support audio\/webm/);
  assert.equal(sttCalls, 1, "unsupported audio is rejected before a provider request");
  process.env.LEARNBUDDY_STT_MODEL = "MiniMax-M3";
  assert.throws(() => getSTTProvider(), /must be asr-1.0/);
});
