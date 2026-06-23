import crypto from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnalyticsRepository } from "@/server/analytics-repository";
import { estimateAiCost } from "@/server/ai-cost";
import { normalizeAiDailyLimit, normalizeAiDailyTokenLimit } from "@/server/ai-budget";
import { evaluateLectureAiScope } from "@/server/ai-scope";
import { retrieveLectureSources } from "@/server/lecture-retrieval";
import { configuredAIProviderInfo, getAIProvider, type AIProviderResult } from "@/server/providers/ai";
import { getLectureRepository } from "@/server/repository";

const MAX_AI_CHAT_BYTES = 8192;

const schema = z.object({
  lectureToken: z.string().trim().min(1).max(160),
  question: z.string().trim().min(1).max(1000),
  message: z.string().trim().min(1).max(1000),
  anonymousKey: z.string().trim().min(8).max(160).optional(),
  pseudonym: z.string().trim().min(1).max(80).optional(),
  stream: z.boolean().optional()
});

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.replace(/\s+/g, " ").trim().length / 4));
}

function proxyAnonymousKey(request: Request, lectureToken: string) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  const digest = crypto.createHash("sha256").update(`${lectureToken}:${forwardedFor}:${userAgent}`).digest("hex").slice(0, 24);
  return `proxy_${digest}`;
}

function sameUtcDay(left: string, right: Date) {
  const value = new Date(left);
  return (
    value.getUTCFullYear() === right.getUTCFullYear() &&
    value.getUTCMonth() === right.getUTCMonth() &&
    value.getUTCDate() === right.getUTCDate()
  );
}

function eventTokenTotal(event: { payload: Record<string, unknown> }) {
  const tokens = event.payload.tokens;
  if (!tokens || typeof tokens !== "object") return 0;
  const total = "total" in tokens ? Number(tokens.total) : 0;
  return Number.isFinite(total) ? total : 0;
}

function streamAnswer(input: {
  answer: string;
  limit: number;
  remaining: number;
  tokenLimit: number;
  tokensRemaining: number;
  provider: string;
  model: string;
  streamSource: "provider" | "local" | "none";
  sources: Array<{ sourceRef: string; excerpt: string; score?: number; retrievalMethod?: "vector" | "text" }>;
}) {
  const encoder = new TextEncoder();
  const chunks = input.answer.match(/.{1,42}(?:\s|$)/g)?.map((chunk) => chunk.trim()).filter(Boolean) ?? [input.answer];

  return new Response(new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "token", value: `${chunk} ` })}\n`));
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      controller.enqueue(encoder.encode(`${JSON.stringify({
        type: "done",
        limit: input.limit,
        remaining: input.remaining,
        tokenLimit: input.tokenLimit,
        tokensRemaining: input.tokensRemaining,
        provider: input.provider,
        model: input.model,
        streamSource: input.streamSource,
        sources: input.sources
      })}\n`));
      controller.close();
    }
  }), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function streamProviderAnswer(input: {
  chunks: AsyncIterable<string>;
  complete: () => Promise<{
    limit: number;
    remaining: number;
    tokenLimit: number;
    tokensRemaining: number;
    provider: string;
    model: string;
    streamSource: "provider" | "local" | "none";
    sources: Array<{ sourceRef: string; excerpt: string; score?: number; retrievalMethod?: "vector" | "text" }>;
  }>;
  onError: (error: unknown) => Promise<void>;
}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      let completionStarted = false;
      try {
        for await (const chunk of input.chunks) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "token", value: chunk })}\n`));
        }
        completionStarted = true;
        const donePayload = await input.complete();
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done", ...donePayload })}\n`));
      } catch (error) {
        if (!completionStarted) {
          void input.complete().catch(() => undefined);
        }
        await input.onError(error);
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: "KI-Provider konnte den Stream nicht abschließen." })}\n`));
      } finally {
        controller.close();
      }
    }
  }), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_AI_CHAT_BYTES) {
    return NextResponse.json({ error: "KI-Anfrage ist zu groß." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const lectureRepository = getLectureRepository();
  const lecture = await lectureRepository.getLectureByToken(parsed.data.lectureToken);
  if (!lecture) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const analytics = getAnalyticsRepository();
  const anonymousKey = parsed.data.anonymousKey ?? proxyAnonymousKey(request, parsed.data.lectureToken);
  const pseudonym = parsed.data.pseudonym ?? "Learnmodus";
  const providerInfo = configuredAIProviderInfo();
  const eventPayload = {
    mode: "learn",
    question: parsed.data.question,
    message: parsed.data.message,
    provider: providerInfo.provider,
    model: providerInfo.model
  };
  const recordAIEvent = (eventType: string, payload: Record<string, unknown>) =>
    analytics.recordEvent({
      lectureToken: parsed.data.lectureToken,
      eventType,
      anonymousKey,
      pseudonym,
      payload
    });

  const now = Date.now();
  if (new Date(lecture.aiAccessUntil).getTime() < now) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", { ...eventPayload, reason: "expired", status: 403 });
    return NextResponse.json({ error: "KI-Zugriff ist abgelaufen." }, { status: 403 });
  }

  const scope = evaluateLectureAiScope({ lecture, message: parsed.data.message });
  if (!scope.allowed) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "scope",
      status: 403,
      scopeReason: scope.reason,
      matchedTerms: scope.matchedTerms,
      offTopicTerms: scope.offTopicTerms
    });
    return NextResponse.json({
      error: "Der KI-Assistent beantwortet nur Fragen zur aktuellen Vorlesung und Übung.",
      reason: "scope",
      scopeReason: scope.reason
    }, { status: 403 });
  }

  const lectureLimit = normalizeAiDailyLimit(lecture.aiDailyLimit);
  const lectureTokenLimit = normalizeAiDailyTokenLimit(lecture.aiDailyTokenLimit);
  const seriesLimit = normalizeAiDailyLimit(lecture.seriesAiDailyLimit, lectureLimit);
  const seriesTokenLimit = normalizeAiDailyTokenLimit(lecture.seriesAiDailyTokenLimit, lectureTokenLimit);
  const tenantLimit = normalizeAiDailyLimit(lecture.tenantAiDailyLimit, seriesLimit);
  const tenantTokenLimit = normalizeAiDailyTokenLimit(lecture.tenantAiDailyTokenLimit, seriesTokenLimit);
  const events = await analytics.listEvents();
  const answeredTodayForUser = events.filter(
    (event) =>
      event.anonymousKey === anonymousKey &&
      event.eventType === "ai_chat_answered" &&
      sameUtcDay(event.occurredAt, new Date())
  );
  const answeredToday = answeredTodayForUser.filter((event) => event.lectureToken === parsed.data.lectureToken);
  const seriesLectureTokens = new Set(
    (await lectureRepository.listLectures())
      .filter((item) => item.seriesTitle === lecture.seriesTitle)
      .map((item) => item.publicToken)
  );
  const tenantLectureTokens = new Set(
    (await lectureRepository.listLectures())
      .filter((item) => item.tenantBudgetKey === lecture.tenantBudgetKey)
      .map((item) => item.publicToken)
  );
  seriesLectureTokens.add(parsed.data.lectureToken);
  tenantLectureTokens.add(parsed.data.lectureToken);
  const seriesAnsweredToday = answeredTodayForUser.filter((event) => event.lectureToken && seriesLectureTokens.has(event.lectureToken));
  const tenantAnsweredToday = events.filter(
    (event) =>
      event.eventType === "ai_chat_answered" &&
      event.lectureToken &&
      tenantLectureTokens.has(event.lectureToken) &&
      sameUtcDay(event.occurredAt, new Date())
  );
  const usedToday = answeredToday.length;
  const seriesUsedToday = seriesAnsweredToday.length;
  const tenantUsedToday = tenantAnsweredToday.length;
  const tokensUsedToday = answeredToday.reduce((sum, event) => sum + eventTokenTotal(event), 0);
  const seriesTokensUsedToday = seriesAnsweredToday.reduce((sum, event) => sum + eventTokenTotal(event), 0);
  const tenantTokensUsedToday = tenantAnsweredToday.reduce((sum, event) => sum + eventTokenTotal(event), 0);

  if (usedToday >= lectureLimit) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", { ...eventPayload, reason: "rate_limit", status: 429, limit: lectureLimit, usedToday });
    return NextResponse.json({ error: `KI-Tageslimit erreicht (${lectureLimit} Fragen pro Tag).`, limit: lectureLimit, remaining: 0 }, { status: 429 });
  }

  if (seriesUsedToday >= seriesLimit) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "series_rate_limit",
      status: 429,
      seriesTitle: lecture.seriesTitle,
      seriesLimit,
      seriesUsedToday
    });
    return NextResponse.json({
      error: `KI-Reihenlimit erreicht (${seriesLimit} Fragen pro Tag in dieser Vorlesungsreihe).`,
      limit: seriesLimit,
      remaining: 0
    }, { status: 429 });
  }

  if (tenantUsedToday >= tenantLimit) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "tenant_rate_limit",
      status: 429,
      tenantLimit,
      tenantUsedToday
    });
    return NextResponse.json({
      error: `KI-Kontolimit erreicht (${tenantLimit} Fragen pro Tag).`,
      limit: tenantLimit,
      remaining: 0
    }, { status: 429 });
  }

  const sources = await retrieveLectureSources({
    lecture,
    query: `${parsed.data.question}\n${parsed.data.message}`,
    limit: 3
  });
  const inputTokens = estimateTokens(
    [
      parsed.data.question,
      parsed.data.message,
      sources.map((source) => `${source.sourceRef}: ${source.content}`).join("\n")
    ].join("\n")
  );
  const reservedOutputTokens = 120;
  const estimatedTotalTokens = inputTokens + reservedOutputTokens;

  if (tokensUsedToday + estimatedTotalTokens > lectureTokenLimit) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "token_budget",
      status: 429,
      tokenLimit: lectureTokenLimit,
      tokensUsedToday,
      estimatedTotalTokens,
      sources: sources.map((source) => ({ id: source.id, sourceRef: source.sourceRef, score: source.score, retrievalMethod: source.retrievalMethod }))
    });
    return NextResponse.json({
      error: `KI-Tokenbudget erreicht (${lectureTokenLimit} Tokens pro Tag).`,
      tokenLimit: lectureTokenLimit,
      tokensRemaining: Math.max(0, lectureTokenLimit - tokensUsedToday)
    }, { status: 429 });
  }

  if (seriesTokensUsedToday + estimatedTotalTokens > seriesTokenLimit) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "series_token_budget",
      status: 429,
      seriesTitle: lecture.seriesTitle,
      seriesTokenLimit,
      seriesTokensUsedToday,
      estimatedTotalTokens,
      sources: sources.map((source) => ({ id: source.id, sourceRef: source.sourceRef, score: source.score, retrievalMethod: source.retrievalMethod }))
    });
    return NextResponse.json({
      error: `KI-Reihenbudget erreicht (${seriesTokenLimit} Tokens pro Tag in dieser Vorlesungsreihe).`,
      tokenLimit: seriesTokenLimit,
      tokensRemaining: Math.max(0, seriesTokenLimit - seriesTokensUsedToday)
    }, { status: 429 });
  }

  if (tenantTokensUsedToday + estimatedTotalTokens > tenantTokenLimit) {
    await recordAIEvent("ai_chat_requested", eventPayload);
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "tenant_token_budget",
      status: 429,
      tenantTokenLimit,
      tenantTokensUsedToday,
      estimatedTotalTokens,
      sources: sources.map((source) => ({ id: source.id, sourceRef: source.sourceRef, score: source.score, retrievalMethod: source.retrievalMethod }))
    });
    return NextResponse.json({
      error: `KI-Kontobudget erreicht (${tenantTokenLimit} Tokens pro Tag).`,
      tokenLimit: tenantTokenLimit,
      tokensRemaining: Math.max(0, tenantTokenLimit - tenantTokensUsedToday)
    }, { status: 429 });
  }

  await recordAIEvent("ai_chat_requested", eventPayload);
  let aiProvider: ReturnType<typeof getAIProvider>;
  try {
    aiProvider = getAIProvider();
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI provider configuration failed.";
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "provider_config",
      status: 503,
      providerError: message
    });
    return NextResponse.json({ error: "KI-Provider ist nicht korrekt konfiguriert." }, { status: 503 });
  }
  const sourcePayload = sources.map((source) => ({
    id: source.id,
    sourceRef: source.sourceRef,
    score: source.score,
    retrievalMethod: source.retrievalMethod
  }));
  const effectiveLimit = Math.min(lectureLimit, seriesLimit, tenantLimit);
  const effectiveTokenLimit = Math.min(lectureTokenLimit, seriesTokenLimit, tenantTokenLimit);
  const responseSources = sources.map((source) => ({
    sourceRef: source.sourceRef,
    excerpt: source.content,
    score: source.score,
    retrievalMethod: source.retrievalMethod
  }));

  async function finalizeProviderResult(providerResult: AIProviderResult, streaming: boolean, streamSource: "provider" | "local" | "none") {
    const answer = providerResult.answer;
    const providerUsage = providerResult.usage;
    const outputTokens = providerUsage?.outputTokens ?? estimateTokens(answer);
    const effectiveInputTokens = providerUsage?.inputTokens ?? inputTokens;
    const totalTokens = providerUsage?.totalTokens ?? effectiveInputTokens + outputTokens;
    const costEstimate = estimateAiCost({
      inputTokens: effectiveInputTokens,
      outputTokens,
      provider: aiProvider.info.provider,
      model: aiProvider.info.model
    });
    const effectiveTokensRemaining = Math.min(
      Math.max(0, lectureTokenLimit - tokensUsedToday - totalTokens),
      Math.max(0, seriesTokenLimit - seriesTokensUsedToday - totalTokens),
      Math.max(0, tenantTokenLimit - tenantTokensUsedToday - totalTokens)
    );
    await recordAIEvent("ai_chat_answered", {
      ...eventPayload,
      status: 200,
      streaming,
      streamSource,
      limit: effectiveLimit,
      remaining: effectiveRemaining,
      lectureLimit,
      lectureRemaining: Math.max(0, lectureLimit - usedToday - 1),
      seriesLimit,
      seriesRemaining: Math.max(0, seriesLimit - seriesUsedToday - 1),
      tenantLimit,
      tenantRemaining: Math.max(0, tenantLimit - tenantUsedToday - 1),
      tokenLimit: effectiveTokenLimit,
      tokensRemaining: effectiveTokensRemaining,
      lectureTokenLimit,
      lectureTokensRemaining: Math.max(0, lectureTokenLimit - tokensUsedToday - totalTokens),
      seriesTokenLimit,
      seriesTokensRemaining: Math.max(0, seriesTokenLimit - seriesTokensUsedToday - totalTokens),
      tenantTokenLimit,
      tenantTokensRemaining: Math.max(0, tenantTokenLimit - tenantTokensUsedToday - totalTokens),
      tokens: {
        input: effectiveInputTokens,
        output: outputTokens,
        total: totalTokens
      },
      costEstimate: {
        provider: costEstimate.provider,
        model: costEstimate.model,
        currency: costEstimate.currency,
        estimatedEur: costEstimate.estimatedEur,
        inputEurPer1k: costEstimate.inputEurPer1k,
        outputEurPer1k: costEstimate.outputEurPer1k
      },
      sources: sourcePayload
    });
    return {
      answer,
      limit: effectiveLimit,
      remaining: effectiveRemaining,
      tokenLimit: effectiveTokenLimit,
      tokensRemaining: effectiveTokensRemaining,
      provider: aiProvider.info.provider,
      model: aiProvider.info.model,
      streamSource,
      sources: responseSources
    };
  }

  const effectiveRemaining = Math.min(
    Math.max(0, lectureLimit - usedToday - 1),
    Math.max(0, seriesLimit - seriesUsedToday - 1),
    Math.max(0, tenantLimit - tenantUsedToday - 1)
  );

  if (parsed.data.stream && aiProvider.streamExplain) {
    try {
      const providerStream = await aiProvider.streamExplain({
        lecture,
        question: parsed.data.question,
        message: parsed.data.message,
        sources
      });
      return streamProviderAnswer({
        chunks: providerStream.chunks,
        complete: async () => {
          const result = await finalizeProviderResult(await providerStream.completed, true, "provider");
          return {
            limit: result.limit,
            remaining: result.remaining,
            tokenLimit: result.tokenLimit,
            tokensRemaining: result.tokensRemaining,
            provider: result.provider,
            model: result.model,
            streamSource: result.streamSource,
            sources: result.sources
          };
        },
        onError: async (error) => {
          const message = error instanceof Error ? error.message : "AI provider stream failed.";
          await recordAIEvent("ai_chat_blocked", {
            ...eventPayload,
            reason: "provider_stream_error",
            status: 502,
            message
          });
        }
      });
    } catch {
      // Fall through to the stable complete-answer path if the provider cannot open a native stream.
    }
  }

  let providerResult: AIProviderResult;
  try {
    providerResult = await aiProvider.explain({
      lecture,
      question: parsed.data.question,
      message: parsed.data.message,
      sources
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI provider failed.";
    await recordAIEvent("ai_chat_blocked", {
      ...eventPayload,
      reason: "provider_error",
      status: 502,
      message
    });
    return NextResponse.json({ error: "KI-Provider konnte nicht antworten." }, { status: 502 });
  }

  const result = await finalizeProviderResult(providerResult, parsed.data.stream === true, parsed.data.stream ? "local" : "none");

  if (parsed.data.stream) {
    return streamAnswer({
      answer: result.answer,
      limit: result.limit,
      remaining: result.remaining,
      tokenLimit: result.tokenLimit,
      tokensRemaining: result.tokensRemaining,
      provider: result.provider,
      model: result.model,
      streamSource: result.streamSource,
      sources: result.sources
    });
  }

  return NextResponse.json({
    answer: result.answer,
    limit: result.limit,
    remaining: result.remaining,
    tokenLimit: result.tokenLimit,
    tokensRemaining: result.tokensRemaining,
    provider: result.provider,
    model: result.model,
    streamSource: result.streamSource,
    sources: result.sources
  });
}
