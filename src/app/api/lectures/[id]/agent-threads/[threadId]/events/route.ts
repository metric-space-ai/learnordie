import { NextResponse } from "next/server";

import { getLecturerSession } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id, threadId } = (await context.params) as { id: string; threadId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(threadId)) {
    return NextResponse.json({ error: "Agent-Thread nicht gefunden." }, { status: 404 });
  }

  const thread = await getLectureRepository().getAgentThread(id, threadId, session.email);
  if (!thread) return NextResponse.json({ error: "Agent-Thread nicht gefunden." }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of thread.events ?? []) {
        controller.enqueue(encoder.encode(`event: ${event.type}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode(`event: thread\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: thread.status, threadId: thread.id })}\n\n`));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
