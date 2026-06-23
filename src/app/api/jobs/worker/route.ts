import { NextResponse } from "next/server";

import { runQueuedJobs } from "@/server/queued-jobs";
import { isAuthorizedWorkerRequest } from "@/server/worker-access";
import { normalizeWorkerLimit } from "@/server/worker-policy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = normalizeWorkerLimit(url.searchParams.get("limit") ?? 1);
  const result = await runQueuedJobs(limit);
  return NextResponse.json({ ...result, limit });
}
