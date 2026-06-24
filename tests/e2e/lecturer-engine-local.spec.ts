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
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail").fill(`engine-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Magic Link senden" }).click();
  const link = page.getByRole("link", { name: "Referentenbereich öffnen" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("Magic link was not rendered in local mail mode.");
  await page.goto(href);
  await expect(page).toHaveURL(/\/lecturer$/);
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

  await page.reload();
  await expect(page.locator('[data-slide-copy-index="0"]')).toContainText(replacementText);
  assertClean();
});
