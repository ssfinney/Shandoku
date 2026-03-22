import { test, expect } from '@playwright/test';

async function openFreshGame(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('#board .cell')).toHaveCount(81);
}

test.describe('Shandoku smoke + core interactions', () => {
  test('app loads and board renders 81 cells', async ({ page }) => {
    await openFreshGame(page);

    await expect(page.locator('h1')).toContainText('Shandoku');
    await expect(page.locator('#status')).toContainText('Tap a cell');
  });

  test('cell selection works', async ({ page }) => {
    await openFreshGame(page);

    const targetCell = page.locator('.cell:not(.fixed)').first();
    await targetCell.click();
    await expect(targetCell).toHaveClass(/selected/);
  });

  test('entering a number updates the cell', async ({ page }) => {
    await openFreshGame(page);

    await page.evaluate(() => {
      window.__shandokuTest.setBoardState({
        grid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0)),
        startingGrid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0)),
        selected: { r: 0, c: 0 }
      });
    });

    await page.getByRole('button', { name: 'Enter 5' }).click();

    const editedCell = page.locator('.cell[data-r="0"][data-c="0"]');
    await expect(editedCell).toHaveText('5');
    await expect(editedCell).toHaveClass(/user/);
  });

  test('direct conflict is visibly indicated', async ({ page }) => {
    await openFreshGame(page);

    await page.evaluate(() => {
      const emptyBoard = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
      emptyBoard[0][0] = 1;
      window.__shandokuTest.setBoardState({
        grid: emptyBoard,
        startingGrid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0)),
        selected: { r: 0, c: 1 }
      });
    });

    await page.getByRole('button', { name: 'Enter 1' }).click();

    const conflictCell = page.locator('.cell[data-r="0"][data-c="1"]');
    await expect(conflictCell).toHaveClass(/error/);
    await expect(page.locator('#errorStat')).toContainText('err');
  });

  test('notes mode can be toggled', async ({ page }) => {
    await openFreshGame(page);

    const notesBtn = page.locator('#notesModeBtn');
    await notesBtn.click();
    await expect(notesBtn).toContainText('Notes On');
    await expect(notesBtn).toHaveClass(/active/);
  });

  test('saved game can be resumed', async ({ page }) => {
    await openFreshGame(page);

    await page.evaluate(() => {
      window.__shandokuTest.setBoardState({
        grid: [
          [7, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0]
        ],
        startingGrid: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0))
      });
    });

    await page.reload();

    await expect(page.locator('#resumeModal')).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();

    await expect(page.locator('.cell[data-r="0"][data-c="0"]')).toHaveText('7');
  });
});
