import { expect } from '@playwright/test';

export async function openFreshGame(page) {
  await page.goto('/?e2e=1');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.locator('#board .cell')).toHaveCount(81);
}
