import { test, expect } from '@playwright/test';

async function dismissResumeModal(page) {
  const newGameBtn = page.locator('#resumeNoBtn');
  if (await newGameBtn.isVisible({ timeout: 500 })) {
    await newGameBtn.click();
  }
}

async function waitForTestApi(page) {
  await page.waitForFunction(() => !!window.__shandokuTest);
}

test.describe('Rift mode regression coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1');
    await dismissResumeModal(page);
    await waitForTestApi(page);
  });

  test('forceRift creates visible rift node and opens modal on tap', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__shandokuTest.forceRift();
    });

    const riftNode = page.locator('.cell.rift-node').first();
    await expect(riftNode).toBeVisible();

    await riftNode.click();
    await expect(page.locator('#riftModal')).toBeVisible();
    await expect(page.locator('#riftRestoreBtn')).toBeVisible();
  });

  test('restore from Rift modal returns last solvable snapshot', async ({ page }) => {
    await page.evaluate(() => {
      const solvable = Array.from({ length: 9 }, () => Array(9).fill(0));
      solvable[0][0] = 1;
      window.__shandokuTest.setBoardState({
        grid: solvable,
        startingGrid: Array.from({ length: 9 }, () => Array(9).fill(0)),
      });

      const unsolvable = solvable.map((row) => row.slice());
      unsolvable[0][1] = 1;
      window.__shandokuTest.setBoardState({
        grid: unsolvable,
        startingGrid: Array.from({ length: 9 }, () => Array(9).fill(0)),
      });
    });

    await page.evaluate(async () => {
      await window.__shandokuTest.forceRift();
    });

    const riftNode = page.locator('.cell.rift-node').first();
    await expect(riftNode).toBeVisible();
    await riftNode.click();
    await page.locator('#riftRestoreBtn').click();

    await expect(page.locator('[data-r="0"][data-c="0"]')).toHaveText('1');
    await expect(page.locator('[data-r="0"][data-c="1"]')).toHaveText('');
  });
});
