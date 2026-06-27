import { NextResponse } from "next/server";
import {
  authorizeLearnordieProxyRequest,
  learnordieLlmProxyMaxBodyChars,
  learnordieMinimaxApiKey,
  LearnordieLlmProxyError,
  MINIMAX_RESPONSES_INPUT_TOKENS_URL,
  prepareLearnordieInputTokensRequest,
  proxyResponseHeaders
} from "@/server/llm-proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = authorizeLearnordieProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const upstreamKey = learnordieMinimaxApiKey();
  if (!upstreamKey) {
    return NextResponse.json({ error: "Learnordie LLM proxy upstream is not configured." }, { status: 503 });
  }

  const bodyText = await request.text();
  if (bodyText.length > learnordieLlmProxyMaxBodyChars()) {
    return NextResponse.json({ error: "Learnordie LLM proxy request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Learnordie LLM proxy expects JSON." }, { status: 400 });
  }

  let upstreamPayload;
  try {
    upstreamPayload = prepareLearnordieInputTokensRequest(body);
  } catch (error) {
    if (error instanceof LearnordieLlmProxyError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    throw error;
  }
  const upstreamBodyText = JSON.stringify(upstreamPayload);
  if (upstreamBodyText.length > learnordieLlmProxyMaxBodyChars()) {
    return NextResponse.json({ error: "Learnordie LLM proxy request is too large after normalization." }, { status: 413 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(MINIMAX_RESPONSES_INPUT_TOKENS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${upstreamKey}`,
        "content-type": "application/json"
      },
      body: upstreamBodyText
    });
  } catch {
    return NextResponse.json({ error: "Learnordie LLM proxy upstream is not reachable." }, { status: 502 });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: proxyResponseHeaders(upstream)
  });
}
