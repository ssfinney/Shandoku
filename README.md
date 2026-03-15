# Shandoku 😂 — PWA Package

This package is ready for free hosting on GitHub Pages and can be installed to an Android home screen.

## What is included
- `index.html` — full Shandoku Wife Edition game
- `manifest.webmanifest` — installable app metadata
- `sw.js` — service worker for offline play and fast reloads
- `icons/icon-192.png`
- `icons/icon-512.png`

## Publish on GitHub Pages
1. Create a new GitHub repository.
2. Upload all files from this zip.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/root**
5. Save.

Your site will appear at:

`https://YOURUSERNAME.github.io/REPOSITORYNAME/`

## Install on Android Chrome
1. Open the published site in Chrome.
2. Tap the three-dot menu.
3. Tap **Add to Home screen** or **Install app**.

## Offline behavior
Once opened once online, Shandoku will cache its core files and continue working offline.

## Updating later
If you change the app and want users to get the new version, update the cache name in `sw.js`.
