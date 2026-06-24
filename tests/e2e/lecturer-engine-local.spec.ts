import { expect, type Page, test } from "@playwright/test";

function attachDiagnostics(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      problems.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror:${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`response:${response.status()} ${response.url()}`);
  });
  return () => expect(problems, problems.join("\n")).toEqual([]);
}

async function loginLecturer(page: Page) {
  const candidateEmails = Array.from(new Set([
    process.env.E2E_OWNER_EMAIL ?? "e2e@example.test",
    process.env.LOCAL_E2E_LECTURER_EMAIL ?? "referent@example.com"
  ]));

  for (const email of candidateEmails) {
    await page.context().clearCookies();
    await page.goto("/lecturer/login");
    await page.getByLabel("E-Mail").fill(email);
    await page.getByRole("button", { name: "Magic Link senden" }).click();
    const link = page.getByRole("link", { name: "Referentenbereich öffnen" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    if (!href) throw new Error("Magic link was not rendered in local mail mode.");
    await page.goto(href);
    await expect(page).toHaveURL(/\/lecturer$/);
    const titleInput = page.getByRole("textbox", { name: "Folientitel" });
    try {
      await expect(titleInput).toBeVisible({ timeout: 3_000 });
      return;
    } catch {
      // Try the next seeded owner used by the alternate E2E repository mode.
    }
  }

  throw new Error(`No seeded lecturer lecture found for ${candidateEmails.join(", ")}.`);
}

test("Dozentenstudio speichert SlideDocument-Engine-Edits in der Lecture", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  const replacementText = `Engine-Editor speichert einen echten Folientext ${Date.now()}.`;

  await loginLecturer(page);
  await expect(page.getByRole("textbox", { name: "Folientitel" })).toBeVisible();

  await page.getByRole("button", { name: "Engine" }).click();
  await expect(page.locator('[data-studio-engine-editor="true"]')).toBeVisible();
  await page.locator('[data-studio-engine-editor="true"] [data-editor-block-type="paragraph"]').first().click();
  await page.getByLabel("Engine Folientext").fill(replacementText);
  await page.getByRole("button", { name: "Engine-Block speichern" }).click();
  await expect(page.getByText("Engine-Block gespeichert. Bitte Lecture speichern.")).toBeVisible();
  await expect(page.locator('[data-slide-copy-index="0"]')).toContainText(replacementText);

  const saveResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/api/lectures/") &&
    response.request().method() === "PATCH"
  ));
  await page.locator(".studio-save-inline").click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok()).toBe(true);
  const savePayload = await saveResponse.json() as {
    lectures?: Array<{
      title: string;
      slideDocument?: {
        slides?: Array<{
          blocks?: Array<{ type?: string; text?: string }>;
        }>;
      };
    }>;
  };
  const savedLecture = savePayload.lectures?.find((lecture) => lecture.title === "Gleitlagerung");
  expect(savedLecture?.slideDocument?.slides?.[0]?.blocks?.some((block) => (
    block.type === "paragraph" && block.text === replacementText
  ))).toBe(true);

  await page.reload();
  await expect(page.locator('[data-slide-copy-index="0"]')).toContainText(replacementText);
  assertClean();
});
