import crypto from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import type { LecturerSession } from "@/lib/types";
import { getDb } from "./db/client";
import { magicLoginRateLimits, magicLoginTokens } from "./db/schema";
import { configuredPublicAppUrl, isProductionDeployment, shouldUseSecureCookies } from "./runtime-config";

const COOKIE_NAME = "lb_lecturer_session";
export const LECTURER_CSRF_HEADER = "x-learnbuddy-csrf";
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const DEV_SECRET = "learnbuddy-dev-secret-change-before-production";
const PLACEHOLDER_SECRET = "replace-with-a-long-random-secret";
const DEFAULT_MAGIC_LINK_LIMIT = 5;
const DEFAULT_MAGIC_LINK_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAGIC_LINK_BLOCK_MS = 15 * 60 * 1000;
const MAX_MAGIC_TOKEN_LENGTH = 1024;
const SIGNED_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const FALLBACK_LOCAL_APP_ORIGIN = "http://127.0.0.1:3000";

type RateLimitBucket = {
  windowStartedAt: number;
  attemptCount: number;
  blockedUntil?: number;
};

const devMagicLinkRateLimits = new Map<string, RateLimitBucket>();

export class MagicLinkRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Magic link rate limit exceeded.");
    this.name = "MagicLinkRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function secret() {
  const configured = process.env.AUTH_SECRET?.trim();
  if (
    configured &&
    configured.length >= 32 &&
    configured !== DEV_SECRET &&
    configured !== PLACEHOLDER_SECRET
  ) {
    return configured;
  }
  if (isProductionDeployment()) {
    throw new Error("AUTH_SECRET with at least 32 non-placeholder characters is required in production.");
  }
  return configured || DEV_SECRET;
}

function base64url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function createSignedToken(payload: Record<string, unknown>) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifySignedToken<T>(token: string): T | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  try {
    const expected = sign(encoded);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function isPlausibleSignedToken(token: string | null | undefined): token is string {
  if (!token) return false;
  if (token.length > MAX_MAGIC_TOKEN_LENGTH) return false;
  return SIGNED_TOKEN_PATTERN.test(token);
}

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function bucketHash(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function positiveNumberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function magicLinkRateLimitConfig() {
  return {
    limit: Math.max(1, Math.floor(positiveNumberFromEnv("LEARNBUDDY_AUTH_MAGIC_LINK_LIMIT", DEFAULT_MAGIC_LINK_LIMIT))),
    windowMs: positiveNumberFromEnv("LEARNBUDDY_AUTH_MAGIC_LINK_WINDOW_MS", DEFAULT_MAGIC_LINK_WINDOW_MS),
    blockMs: positiveNumberFromEnv("LEARNBUDDY_AUTH_MAGIC_LINK_BLOCK_MS", DEFAULT_MAGIC_LINK_BLOCK_MS)
  };
}

function firstHeaderValue(value: string | null | undefined) {
  return value?.split(",")[0]?.trim() ?? "";
}

function normalizedHttpOrigin(value: string | null | undefined) {
  const candidate = firstHeaderValue(value);
  if (!candidate || /[\r\n]/.test(candidate)) return "";

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function requestHeaderOrigin(headers: Headers) {
  const rawHost = firstHeaderValue(headers.get("x-forwarded-host") ?? headers.get("host"));
  if (!rawHost || /[\r\n\s/@\\?#]/.test(rawHost)) return "";

  const rawProtocol = firstHeaderValue(headers.get("x-forwarded-proto")).toLowerCase();
  const protocol = rawProtocol === "https" ? "https" : "http";
  return normalizedHttpOrigin(`${protocol}://${rawHost}`);
}

function magicLinkOrigin(request: { headers: Headers; url?: string }) {
  const configuredOrigin = normalizedHttpOrigin(configuredPublicAppUrl());
  if (configuredOrigin) return configuredOrigin;

  if (isProductionDeployment()) {
    throw new Error("NEXT_PUBLIC_APP_URL or VERCEL_URL must be a valid http(s) URL for production magic links.");
  }

  return (
    requestHeaderOrigin(request.headers) ||
    normalizedHttpOrigin(request.url) ||
    normalizedHttpOrigin(request.headers.get("origin")) ||
    FALLBACK_LOCAL_APP_ORIGIN
  );
}

function retryAfterSeconds(until: Date | number) {
  const value = typeof until === "number" ? until : until.getTime();
  return Math.max(1, Math.ceil((value - Date.now()) / 1000));
}

function sessionExpiresAt(session: LecturerSession) {
  if (typeof session.expiresAt === "number" && Number.isFinite(session.expiresAt)) {
    return session.expiresAt;
  }

  const issuedAt = Date.parse(session.issuedAt);
  return Number.isFinite(issuedAt) ? issuedAt + SESSION_TTL_MS : 0;
}

function isValidLecturerSession(session: LecturerSession | null): session is LecturerSession {
  if (!session?.email || !session.issuedAt) return false;
  return sessionExpiresAt(session) > Date.now();
}

function canPersistMagicTokens() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

async function evaluateStoredMagicLinkBucket(hash: string) {
  const config = magicLinkRateLimitConfig();
  const now = new Date();
  const windowStartedAt = new Date(now.getTime());
  const [existing] = await getDb()
    .select()
    .from(magicLoginRateLimits)
    .where(eq(magicLoginRateLimits.bucketHash, hash))
    .limit(1);

  if (!existing) {
    const inserted = await getDb()
      .insert(magicLoginRateLimits)
      .values({
        bucketHash: hash,
        windowStartedAt,
        attemptCount: 1,
        updatedAt: now
      })
      .onConflictDoNothing({ target: magicLoginRateLimits.bucketHash })
      .returning({ id: magicLoginRateLimits.id });
    if (inserted.length === 1) {
      return;
    }
    await evaluateStoredMagicLinkBucket(hash);
    return;
  }

  if (existing.blockedUntil && existing.blockedUntil.getTime() > now.getTime()) {
    throw new MagicLinkRateLimitError(retryAfterSeconds(existing.blockedUntil));
  }

  const windowEndsAt = existing.windowStartedAt.getTime() + config.windowMs;
  if (windowEndsAt <= now.getTime()) {
    await getDb()
      .update(magicLoginRateLimits)
      .set({
        windowStartedAt,
        attemptCount: 1,
        blockedUntil: null,
        updatedAt: now
      })
      .where(eq(magicLoginRateLimits.bucketHash, hash));
    return;
  }

  const nextAttemptCount = existing.attemptCount + 1;
  const blockedUntil = nextAttemptCount > config.limit ? new Date(now.getTime() + config.blockMs) : null;
  await getDb()
    .update(magicLoginRateLimits)
    .set({
      attemptCount: nextAttemptCount,
      blockedUntil,
      updatedAt: now
    })
    .where(eq(magicLoginRateLimits.bucketHash, hash));

  if (blockedUntil) {
    throw new MagicLinkRateLimitError(retryAfterSeconds(blockedUntil));
  }
}

function evaluateDevMagicLinkBucket(hash: string) {
  const config = magicLinkRateLimitConfig();
  const now = Date.now();
  const existing = devMagicLinkRateLimits.get(hash);

  if (!existing || existing.windowStartedAt + config.windowMs <= now) {
    devMagicLinkRateLimits.set(hash, {
      windowStartedAt: now,
      attemptCount: 1
    });
    return;
  }

  if (existing.blockedUntil && existing.blockedUntil > now) {
    throw new MagicLinkRateLimitError(retryAfterSeconds(existing.blockedUntil));
  }

  existing.attemptCount += 1;
  if (existing.attemptCount > config.limit) {
    existing.blockedUntil = now + config.blockMs;
    throw new MagicLinkRateLimitError(retryAfterSeconds(existing.blockedUntil));
  }
}

async function enforceMagicLinkRateLimit(email: string) {
  const hash = bucketHash(`magic-login:email:${normalizedEmail(email)}`);
  if (canPersistMagicTokens()) {
    await evaluateStoredMagicLinkBucket(hash);
    return;
  }

  if (isProductionDeployment()) {
    throw new Error("DATABASE_URL is required for production magic-link rate limits.");
  }

  evaluateDevMagicLinkBucket(hash);
}

async function storeMagicToken(input: { email: string; token: string; expiresAt: number }) {
  await getDb().insert(magicLoginTokens).values({
    email: input.email,
    tokenHash: tokenHash(input.token),
    expiresAt: new Date(input.expiresAt)
  });
}

async function consumeStoredMagicToken(input: { email: string; token: string }) {
  const rows = await getDb()
    .update(magicLoginTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(magicLoginTokens.email, input.email),
      eq(magicLoginTokens.tokenHash, tokenHash(input.token)),
      isNull(magicLoginTokens.consumedAt),
      gt(magicLoginTokens.expiresAt, new Date())
    ))
    .returning({ id: magicLoginTokens.id });

  return rows.length === 1;
}

export async function createMagicToken(email: string) {
  const cleanEmail = normalizedEmail(email);
  await enforceMagicLinkRateLimit(cleanEmail);
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const token = createSignedToken({
    email: cleanEmail,
    purpose: "lecturer-login",
    expiresAt,
    nonce: crypto.randomBytes(24).toString("base64url")
  });

  if (canPersistMagicTokens()) {
    await storeMagicToken({ email: cleanEmail, token, expiresAt });
  } else if (isProductionDeployment()) {
    throw new Error("DATABASE_URL is required for production magic-link tokens.");
  }

  return token;
}

export function createMagicLoginLink(request: { headers: Headers; url?: string }, token: string) {
  const origin = magicLinkOrigin(request);
  return `${origin}/auth/magic?token=${encodeURIComponent(token)}`;
}

export async function consumeMagicToken(token: string) {
  if (!isPlausibleSignedToken(token)) return null;

  const payload = verifySignedToken<{ email: string; purpose: string; expiresAt: number }>(token);

  if (!payload || payload.purpose !== "lecturer-login" || payload.expiresAt < Date.now()) {
    return null;
  }

  if (canPersistMagicTokens()) {
    const consumed = await consumeStoredMagicToken({ email: payload.email, token });
    if (!consumed) return null;
  } else if (isProductionDeployment()) {
    return null;
  }

  const session: LecturerSession = {
    email: payload.email,
    issuedAt: new Date().toISOString(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSignedToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: SESSION_TTL_SECONDS,
    path: "/"
  });

  return session;
}

export async function getLecturerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = verifySignedToken<LecturerSession>(token);
  return isValidLecturerSession(session) ? session : null;
}

export function createLecturerCsrfToken(session: LecturerSession) {
  return createSignedToken({
    purpose: "lecturer-csrf",
    email: session.email,
    issuedAt: session.issuedAt,
    expiresAt: Math.min(sessionExpiresAt(session), Date.now() + SESSION_TTL_MS)
  });
}

export function isValidLecturerCsrfToken(token: string | null | undefined, session: LecturerSession) {
  if (!token) return false;
  const payload = verifySignedToken<{
    purpose?: string;
    email?: string;
    issuedAt?: string;
    expiresAt?: number;
  }>(token);

  return Boolean(
    payload &&
    payload.purpose === "lecturer-csrf" &&
    payload.email === session.email &&
    payload.issuedAt === session.issuedAt &&
    typeof payload.expiresAt === "number" &&
    payload.expiresAt > Date.now()
  );
}

export function isValidLecturerCsrfRequest(request: Request, session: LecturerSession) {
  return isValidLecturerCsrfToken(request.headers.get(LECTURER_CSRF_HEADER), session);
}

export async function clearLecturerSession() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: 0,
    path: "/"
  });
}
