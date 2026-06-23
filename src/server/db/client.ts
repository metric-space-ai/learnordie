import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let client: postgres.Sql | undefined;

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured. Use the demo repository for local UI-only flows.");
  }

  client ??= postgres(databaseUrl, {
    prepare: false,
    max: 5
  });

  return drizzle(client, { schema });
}
