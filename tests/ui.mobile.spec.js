import { test, expect } from '@playwright/test';
import { openFreshGame } from './test-utils.js';

test.describe('Mobile viewport behavior', () => {
  test('board renders and remains interactive on mobile profile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'This test is intended for mobile projects.');
    await openFreshGame(page);
    await expect(page.locator('.board-shell')).toBeVisible();

    const touchCell = page.locator('.cell:not(.fixed)').first();
    await touchCell.tap();
    await expect(touchCell).toHaveClass(/selected/);
  });
});
