import { NextResponse } from "next/server";

import {
  authorizePiCodingAgentRequest,
  piCodingAgentMaxBodyBytes,
  PiCodingAgentServiceError,
  runStatelessPiCodingAgent
} from "@/server/pi-coding-agent-service";
import { readJsonBody } from "@/server/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  const auth = authorizePiCodingAgentRequest(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const bodyResult = await readJsonBody(request, piCodingAgentMaxBodyBytes());
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.status === 413 ? "Pi coding-agent request is too large." : "Invalid JSON request." }, { status: bodyResult.status });
  }

  try {
    const result = await runStatelessPiCodingAgent(bodyResult.body);
    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof PiCodingAgentServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Pi coding-agent run failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
