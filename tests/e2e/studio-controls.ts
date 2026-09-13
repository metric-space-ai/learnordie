import type { Page } from "@playwright/test";

export async function openStudioActions(page: Page) {
  const menu = page.locator(".studio-view-menu");
  if (!await menu.evaluate((node) => (node as HTMLDetailsElement).open)) {
    await page.getByLabel("Weitere Vorlesungsaktionen", { exact: true }).click();
  }
}

export async function toggleStudioPreview(page: Page, name: "Vorschau" | "Bearbeiten" = "Vorschau") {
  await openStudioActions(page);
  await page.getByRole("button", { name, exact: true }).click();
}
