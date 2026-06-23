import { NextResponse } from "next/server";

import { runQueuedJobs } from "@/server/queued-jobs";
import { isAuthorizedWorkerRequest } from "@/server/worker-access";
import { configuredWorkerCronLimit, normalizeWorkerLimit } from "@/server/worker-policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedWorkerRequest(request, { allowCronSecret: true })) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = normalizeWorkerLimit(url.searchParams.get("limit") ?? configuredWorkerCronLimit(), configuredWorkerCronLimit());
  const result = await runQueuedJobs(limit);
  return NextResponse.json({
    trigger: "cron",
    limit,
    ...result
  });
}
