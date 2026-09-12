import { scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);

export type TestAccount = { email: string; passwordHash: string; expiresAt: string };

// Explicitly configured, expiring QA identities only. Never a default password
// or an alternate login for a real lecturer's email address.
export function configuredTestAccounts(): TestAccount[] {
  try {
    const data: unknown = JSON.parse(process.env.LEARNBUDDY_TEST_ACCOUNTS ?? "[]");
    if (!Array.isArray(data) || data.length > 10) return [];
    return data.filter((entry): entry is TestAccount => Boolean(
      entry && typeof entry.email === "string" && /^[a-z0-9._+-]+@learnordie\.test$/.test(entry.email) &&
      typeof entry.passwordHash === "string" && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(entry.passwordHash) &&
      typeof entry.expiresAt === "string" && Date.parse(entry.expiresAt) > Date.now()
    ));
  } catch {
    return [];
  }
}

export function testAccountVersion(account: TestAccount): string {
  return createHash("sha256").update(JSON.stringify(account)).digest("hex");
}

export async function verifyTestAccountPassword(account: TestAccount | undefined, password: string): Promise<boolean> {
  if (!account || password.length < 16 || password.length > 256) return false;
  const [, salt, expected] = account.passwordHash.split("$");
  const actual = await deriveKey(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
