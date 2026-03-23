import { expect } from '@playwright/test';

export async function openFreshGame(page) {
  await page.goto('/?e2e=1');

  const resumeNoBtn = page.locator('#resumeNoBtn');
  if (await resumeNoBtn.isVisible().catch(() => false)) {
    await resumeNoBtn.click();
  }

  await expect(page.locator('#board .cell')).toHaveCount(81, { timeout: 15000 });
}
