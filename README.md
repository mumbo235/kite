# Kite

A customizable Chromium browser built on Electron. Its UI is plain HTML, CSS and JavaScript, so you can change anything and rebuild in seconds.

- **Tabs:** vertical tabs in the sidebar or horizontal tabs on top (switch with `Ctrl+Shift+L`). Includes pinned tabs, drag to reorder, workspaces, sleeping tabs, and session restore.
- **Sidebar tools:** AI chat (ChatGPT, Gemini, Claude, Grok, or any chat site you add), bookmarks, history, downloads, notes, a to-do list, and pinnable web panels.
- **Customization:** themes (6 built in, plus your own made in an editor or imported as JSON), accent color, fonts, radius, density, animation speed, and custom CSS for the UI and for any website. You can also reorder and hide toolbar buttons and sidebar tools, use compact mode, and auto-hide the sidebar.
- **Input:** a command palette (`Ctrl+K`), rebindable shortcuts, mouse gestures (hold the right button and draw), and the mouse back/forward buttons.
- **Privacy:** a built-in ad and tracker blocker with a per-site toggle, HTTPS-only mode, DNT/GPC, clear-on-exit, a permission prompt for each site, and separate profiles.
- **Extensions:** install from the Chrome Web Store ("Add to Kite") or load an unpacked extension. Extension buttons appear in the toolbar.

## Run it

```bash
npm install
npm start
```

`npm run dev` also opens DevTools for the browser UI.

## Build an installable app

```bash
npm run build:linux
```

This creates `dist/Kite-<version>.AppImage` and a `.deb`. Use `npm run build` on Windows or macOS to build for that platform.

> Needs Node 18+. Electron is pinned to v39, the newest version that installs on Node 18. On Node 22+ you can upgrade it with `npm i -D electron@latest`.

## Publishing (download page + install links)

1. **Release a version** by pushing a tag:
   `git tag v0.1.0 && git push --tags`. The workflow in `.github/workflows/release.yml` builds Kite on GitHub's Linux, Windows and Mac machines and attaches every installer to a GitHub Release.
2. **Direct download links never change**, because the files have no version in their names:
   - `https://github.com/mumbo235/kite/releases/latest/download/Kite-x86_64.AppImage`
   - `.../kite_amd64.deb`, `.../Kite-Setup-x64.exe`, `.../Kite-Setup-arm64.exe`, `.../Kite-mac-universal.dmg` (and `.zip`)
3. **The download page** (`website/`) is published to GitHub Pages at https://mumbo235.github.io/kite/ by `.github/workflows/pages.yml` whenever `website/` changes on `main`.
4. **One-line installs** then work:
   - Linux / macOS: `curl -fsSL https://mumbo235.github.io/kite/install.sh | sh`
   - Windows (PowerShell): `irm https://mumbo235.github.io/kite/install.ps1 | iex`

Notes:
- **macOS builds** only run on a Mac (the GitHub workflow handles that). Without an Apple Developer ID the app is unsigned. The install script clears macOS's quarantine flag; people opening the `.dmg` by hand must right-click → Open the first time.
- **Windows builds** are unsigned too, so SmartScreen shows "More info → Run anyway" when the `.exe` is opened from a browser. The PowerShell installer avoids that prompt.

## Where things live

```
src/main/          main process (Node)
  index.js         app startup, sessions, permissions, internal kite:// protocol
  browser.js       the window, tabs, side panels and layout
  defaults.js      every setting and its default value  ← start here
  actions.js       every command (shortcuts, palette and menus all use this)
  shortcuts.js     keyboard matching
  menus.js         right-click menus and the ⋯ app menu
  adblock.js       ad/tracker blocking
  extensions.js    Chrome extensions + Web Store
  downloads.js     downloads
  api.js           IPC methods the UI and settings pages can call
src/preload/       bridges between the UI/pages and the main process
src/renderer/      the browser chrome (sidebar, toolbar, tabs, panels)
  styles/base.css  design tokens: colors, radius, motion
  styles/app.css   layout and animations
  js/*.js          UI modules (tabs, toolbar, sidebar, panels, palette)
src/pages/         kite://newtab, settings, history, extensions, error
src/themes/        built-in themes (JSON)
```

### Common tweaks

- **Add a theme:** copy `src/themes/dark.json`, change `id`, `name` and the colors. Or use Settings → Appearance → Create.
- **Add a command:** add a line to `src/main/actions.js`. It shows up in the command palette and can be bound in Settings → Shortcuts.
- **Add an AI chatbot:** Settings → AI chat → Add chatbot (any URL works).
- **Restyle the UI without editing files:** Settings → Appearance → Custom CSS. All colors are CSS variables (`--bg`, `--surface`, `--accent`, …).
- **Add a sidebar tool:** add an entry to `TOOLS` in `src/renderer/js/sidebar.js` and a render function to `RENDER` in `src/renderer/js/panels.js`.

## How it works

The window is an Electron `BaseWindow` with stacked views:

1. The **UI view** (`src/renderer`) draws the whole browser chrome. It reports the exact rectangle of the content area (and of the side panel) to the main process using a `ResizeObserver`, every frame while animations run.
2. Each **tab** is a native `WebContentsView`, placed over that rectangle.
3. **AI chat and web panels** are also `WebContentsView`s. They use their own persistent session, so you stay signed in.

Popups such as the command palette and address-bar suggestions briefly lift the UI view above the page (the "overlay" mode in `browser.js`).

## Debugging

| Env variable | Effect |
| --- | --- |
| `KITE_DEBUG=1` | Print UI/page console errors to the terminal |
| `KITE_SHOT=/some/dir` + `KITE_SCRIPT=test.js` | Run a scripted test that can take screenshots (see `src/main/debug.js`) |

Use `--profile=name` to run a separate profile, e.g. `npx electron . --profile=test`.

## Known limits

- Google sign-in sometimes rejects embedded browsers. If a login page says the browser isn't secure, sign in with an email and password or a passkey instead, or sign in on the site's own page in a normal tab.
- A few Chrome-only extension APIs are missing (see the electron-chrome-extensions docs).
- With mouse gestures on, the right-click menu is built by Kite, so spell-check suggestions aren't shown. Turn gestures off to get them back.
- There is one browser window per profile.
