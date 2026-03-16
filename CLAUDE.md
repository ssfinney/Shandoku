# Shandoku – Claude Agent Memory

## Project Overview
**Shandoku** is a Sudoku PWA ("Wife Edition") built as a single-page app hosted on GitHub Pages.
- **Stack:** Vanilla JS (single IIFE), CSS custom properties, HTML5, Service Worker
- **Live files:** `index.html`, `script.js`, `style.css`, `sw.js`, `manifest.webmanifest`
- **Icons:** `icons/icon-192.png`, `icons/icon-512.png`
- **No build step.** Edit files directly; the app runs as static HTML.

## Architecture
All game logic lives in one self-contained IIFE in `script.js` (~570 lines).
State variables (grid, notes, selected, elapsed, history, future, …) are module-scoped.
There are no modules, bundlers, or frameworks.

### Key Functions
| Function | Purpose |
|---|---|
| `render()` | Rebuilds the entire board DOM. Creates 9 `.block` divs (3×3 outer grid), then appends `.cell` buttons to each block. Cells carry `data-r` / `data-c` attributes for targeted DOM lookup. Calls `updateStats`, `updateToggles`, `updateStatus`, `updateDigitPad`. |
| `placeNumber(n)` | Places a digit or toggles a note. Checks conflicts, fires haptic + error-shake if conflicting. Triggers `celebrate()` if `isSolved()`. |
| `celebrate()` | Adds `.victory-glow` to `.board-shell`, fires okflash on all cells, vibrates, logs `game_won`. |
| `restoreSnapshot(snap)` | Restores undo/redo state. Clears `.victory-glow` before re-rendering. |
| `newGame()` / `applyLoadedData()` | Both clear `.victory-glow` before rendering. |
| `solveBoard()` | Backtracking solver. Returns `ok` boolean; status message reflects success or failure. |
| `saveGame()` / boot | Auto-saves to `localStorage` on every move. Boot prompts `confirm()` to Resume or start New Game when a save exists. |
| `updateDigitPad()` | Adds `.completed` + `disabled` to digit pad buttons whose digit is fully and correctly placed. |

## Board DOM Structure (after Issue #4 fix)
```
#board.board                  ← CSS grid: repeat(3,1fr), gap 6px
  div.block × 9               ← CSS grid: repeat(3,1fr), gap 2px, background var(--thick)
    button.cell[data-r][data-c] × 9
```
**Do NOT** use `boardEl.children[r*9+c]` to find cells — it no longer works.
Use `boardEl.querySelector('[data-r="${r}"][data-c="${c}"]')` instead.

## CSS Architecture
- **Theme variables:** `:root` = dark mode; `body.light` = light mode overrides.
- **Key color variables:**
  - `--fixed` (`#c7d2e9`) – starting/given cells
  - `--user` (`#bfdbfe`) – player-entered cells
  - `--cell` – empty cell background
  - `--thick` – board background color (shows through grid gaps as separator lines)
  - `--accent` / `--accent2` – selection highlight
  - `--error` / `--errorText` – conflict cells
  - `--notesText` – pencil-mark digits (dark: `#94a3b8` for contrast)
  - `--safe-top` / `--safe-bottom` – `env(safe-area-inset-*)` for notch/punch-hole devices
- **Animations:** `.error-shake` (conflict), `.victory-glow` (win), `.okflash` (cell flash on win), `.completed` (fully-placed digit button)
- `viewport-fit=cover` is set in `index.html` so safe-area insets work.

## Service Worker
Cache name: `shandoku-wife-edition-v2`.
- HTML: network-first
- Other assets: cache-first
**After changing any static asset, bump the cache name in `sw.js`** to force clients to update.

## localStorage Keys
- `shandoku-wife-edition-save-v1` – serialised game state (grid, notes as arrays, selected, elapsed, notesMode, autoCleanup, difficulty)
- `shandoku-wife-edition-theme-v1` – `'dark'` or `'light'`

## Branch Convention
Active development branch: `claude/sudoku-ux-enhancements-5CURw`
Push with: `git push -u origin claude/sudoku-ux-enhancements-5CURw`

## Resolved Issues (for context)
| # | Summary | Fix |
|---|---|---|
| UX batch | Contextual highlighting, conflict shake, digit-pad completion, haptic feedback, resume prompt, victory glow, notes contrast | `script.js` + `style.css` |
| glow leak | `victory-glow` persisted after `newGame`/`applyLoadedData` | Clear in `newGame()` and `applyLoadedData()` |
| #4 | Columns 3 & 6 cells were narrower (extra `margin-right`) | Nested grid: `.board` → `.block` → `.cell`; gap-based separators |
| #5 | Fixed vs user cell colors too similar | `--fixed: #c7d2e9`, `--user: #bfdbfe` in both themes |
| #7 | `solveBoard()` showed "Solved." even when solver failed; `victory-glow` leaked through undo/redo | Check `ok=solve()` return value; clear glow in `restoreSnapshot()` |
| #8 | Top safe area (notch/Dynamic Island/Samsung punch-hole) not respected | `--safe-top: env(safe-area-inset-top,0px)`; applied to `body` padding |
