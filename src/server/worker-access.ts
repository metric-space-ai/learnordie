import crypto from "node:crypto";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function configuredSecrets(allowCronSecret: boolean) {
  return [
    process.env.LEARNBUDDY_WORKER_SECRET,
    allowCronSecret ? process.env.CRON_SECRET : undefined
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorizedWorkerRequest(request: Request, options: { allowCronSecret?: boolean } = {}) {
  const token = bearerToken(request);
  if (!token) return false;
  return configuredSecrets(Boolean(options.allowCronSecret)).some((secret) => safeEqual(token, secret));
}
