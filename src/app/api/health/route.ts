import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "pass" | "skip" | "fail"> = {
    app: "pass",
    database: process.env.DATABASE_URL ? "pass" : "skip"
  };

  if (process.env.DATABASE_URL) {
    try {
      await getDb().select({ ok: sql<number>`1` });
    } catch {
      checks.database = "fail";
    }
  }

  const ok = Object.values(checks).every((status) => status !== "fail");
  return NextResponse.json(
    {
      ok,
      checks
    },
    { status: ok ? 200 : 503 }
  );
}
