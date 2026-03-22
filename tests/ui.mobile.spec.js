import { test, expect } from '@playwright/test';

test.describe('Mobile viewport behavior', () => {
  test('board renders and remains interactive on mobile profile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'This test is intended for mobile projects.');

    await page.addInitScript(() => localStorage.clear());
    await page.goto('/?e2e=1');

    await expect(page.locator('#board .cell')).toHaveCount(81);
    await expect(page.locator('.board-shell')).toBeVisible();

    const touchCell = page.locator('.cell:not(.fixed)').first();
    await touchCell.tap();
    await expect(touchCell).toHaveClass(/selected/);
  });
});
