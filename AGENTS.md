# Shandoku – Agent Instructions

## What Is This Project?
A Sudoku Progressive Web App (PWA) called **Shandoku**. Single-page, no build step, no frameworks.
Key files: `index.html`, `script.js`, `style.css`, `sw.js`, `manifest.webmanifest`.

## Before Making Any Change
1. **Read `CLAUDE.md`** for full domain context: architecture, key functions, CSS variables, DOM structure, resolved issues.
2. **Read the target file(s)** before editing — never guess at existing code.
3. The board DOM is a **nested grid** (`#board.board` → `.block` × 9 → `.cell` × 9). Cells have `data-r` and `data-c` attributes. Do NOT use `boardEl.children[r*9+c]`.

## Git Workflow
- Active branch: `claude/sudoku-ux-enhancements-5CURw`
- Push: `git push -u origin claude/sudoku-ux-enhancements-5CURw`
- The remote URL is `http://local_proxy@127.0.0.1:41105/git/ssfinney/Shandoku` — only git operations work through this proxy (not HTTP browsing or the Gitea issues API).
- To view issues you must ask the user to paste them.

## Coding Guidelines
- Keep changes minimal and scoped — no refactors beyond what's needed.
- No build tools, transpilers, or npm packages. Pure JS / CSS.
- When adding new CSS state (e.g. a new class on `.board-shell`), always audit every code path that resets game state (`newGame`, `applyLoadedData`, `restoreSnapshot`) and clear it there too.
- After restructuring the board DOM, any code that looked up cells by index must be updated to use `data-r`/`data-c` attribute selectors.
- If the Service Worker cache name needs bumping (after static asset changes that must be re-fetched), update `CACHE_NAME` in `sw.js`.

## Testing Checklist (no automated tests — verify manually)
- [ ] All 9 columns display cells at equal width
- [ ] Dark and light themes both render correctly
- [ ] Selecting a cell highlights row/column/block
- [ ] Entering a conflicting number triggers error-shake + double-pulse haptic
- [ ] Fully placed digits become grayed-out in the digit pad
- [ ] Undo/redo works and clears `victory-glow`
- [ ] `solveBoard()` with pre-existing conflicts shows "Could not solve" message
- [ ] On iOS/Android, app content clears the system status bar
- [ ] Service worker still caches the app for offline use
