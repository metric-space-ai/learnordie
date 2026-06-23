import crypto from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

// Smoke test against a DEPLOYED preview (Postgres/Neon-backed). The join code
// ME1-GL-2026 is assumed to already exist (set by the lecturer). Mail on preview is
// Resend (no inline magic link), so the lecturer is authenticated via a minted,
// AUTH_SECRET-signed session cookie — same mechanism as production-smoke.spec.
//
// Run: SMOKE_AUTH_SECRET=... DEPLOY_SMOKE_URL=https://... npx playwright test --config playwright.deploy.config.ts

const JOIN_CODE = "ME1-GL-2026";
const SERIES_TITLE = "Maschinenelemente I";
const AUTH_SECRET = process.env.SMOKE_AUTH_SECRET ?? "";
const LECTURER_EMAIL = process.env.SMOKE_LECTURER_EMAIL ?? "referent@example.edu";

function attachDiagnostics(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) problems.push(`console:${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror:${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`response:${r.status()} ${r.url()}`);
  });
  return () => expect(problems, problems.join("\n")).toEqual([]);
}

function signSessionToken(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

test("Deployed: Student tritt mit bestehendem Code bei und sieht das Postgres-Dashboard", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "An Vorlesung teilnehmen" })).toBeVisible();
  await expect(page.locator(".slide-screen")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gleitlagerung" })).toHaveCount(0);

  await page.locator(".home-join-form input").fill(JOIN_CODE.toLowerCase());
  await page.locator(".home-join-form button[type=submit]").click();

  await expect(page).toHaveURL(/\/join\//);
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();

  await page.locator(".join-form input").fill("DeploySmoke");
  await page.locator(".join-form button[type=submit]").click();

  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();
  await expect(page.getByText(`Code ${JOIN_CODE}`)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();
  assertClean();
});

test("Deployed: Unbekannter Code zeigt Fehler ohne Demo", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  await page.goto("/join/CODE-GIBT-ES-NICHT");
  await expect(page.getByRole("heading", { name: "Diesen Code kennen wir nicht" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gleitlagerung" })).toHaveCount(0);
  assertClean();
});

test("Deployed: Dozent-Studio zeigt den aktiven Join-Code (Postgres getShareInfo)", async ({ page, context, baseURL }) => {
  test.skip(!AUTH_SECRET, "SMOKE_AUTH_SECRET not provided");
  const origin = new URL(baseURL ?? "https://example.com").origin;
  await context.addCookies([{
    name: "lb_lecturer_session",
    value: signSessionToken({
      email: LECTURER_EMAIL,
      issuedAt: new Date().toISOString(),
      expiresAt: Date.now() + 60 * 60 * 1000
    }),
    url: origin,
    httpOnly: true,
    secure: true,
    sameSite: "Lax"
  }]);

  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.locator(".studio-command-menu summary").click();
  await expect(page.locator(".join-code-value")).toHaveText(JOIN_CODE);
});
