import { test, expect } from '@playwright/test';
import { openFreshGame } from './test-utils.js';

test.describe('Gameplay regression placeholders', () => {
  test('deterministic Rift trigger is visible', async ({ page }) => {
    await openFreshGame(page);
    await page.evaluate(() => {
      window.__shandokuTest.setBoardState({
        grid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0)),
        startingGrid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0))
      });
      window.__shandokuTest.forceRift({ r: 0, c: 0 });
    });

    await expect(page.locator('.board-shell')).toHaveClass(/rift-active/);
    await expect(page.locator('.cell.rift-node[data-r="0"][data-c="0"]')).toBeVisible();
    await expect(page.locator('#status')).toContainText('Rift node found');
  });

  test('restore last solvable state from Rift modal', async ({ page }) => {
    await openFreshGame(page);

    await page.evaluate(() => {
      const blank = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
      blank[0][0] = 4;
      window.__shandokuTest.setBoardState({
        grid: blank,
        startingGrid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0)),
        selected: { r: 0, c: 1 }
      });
    });
    await page.getByRole('button', { name: 'Enter 4' }).click();
    await expect(page.locator('.cell[data-r="0"][data-c="1"]')).toHaveText('4');
    await expect(page.locator('.cell[data-r="0"][data-c="1"]')).toHaveClass(/error/);

    await page.evaluate(() => window.__shandokuTest.forceRift({ r: 0, c: 1 }));
    await page.locator('.cell.rift-node[data-r="0"][data-c="1"]').click();
    await expect(page.locator('#riftModal')).toBeVisible();
    await page.getByRole('button', { name: 'Restore last solvable' }).click();

    await expect(page.locator('.cell[data-r="0"][data-c="1"]')).toHaveText('');
    await expect(page.locator('.board-shell')).not.toHaveClass(/rift-active/);
    await expect(page.locator('#status')).toContainText('Restored to the last solvable state');
  });
});
