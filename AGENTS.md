# Terminal repository guide

Terminal is an Electron and xterm.js desktop client for local Bash/Zsh sessions and Linux SSH hosts. The README documents Node.js 22.12 or newer and Windows x64 portable packaging.

## Code map

- `electron/main.cjs` and `electron/preload.cjs` define the Electron window and its IPC bridge. The main process owns SSH credentials, key file selection, host key verification, and settings persistence.
- `electron/config.cjs` resolves user SSH configuration, including `Include` and `ProxyJump`. `electron/ssh.cjs` manages authentication, PTYs, session cleanup, and output backpressure. The renderer acknowledges each output batch after xterm parses it.
- `electron/local.cjs` runs local Bash/Zsh through node-pty and uses WSL on Windows. SSH and local sessions share the renderer's terminal event and input handling.
- `src/app.js` manages terminal tabs and connects xterm to the IPC bridge. `src/fonts.js`, `src/appearance.js`, `src/themes.js`, and `src/themes.css` handle font calibration and appearance. `src/clipboard.js` handles terminal copy and paste.
- `src/markdown.js` renders terminal selections and buffer snapshots with Marked, DOMPurify, and KaTeX. The renderer loads this module when the reading panel needs it.
- `i18n/` contains the shared message catalogs and multilingual text samples. English is the default locale. Keep documentation and comments in English and non-English text in `i18n/`.
- `build.mjs` bundles the renderer with esbuild. `patches/xterm-ime.mjs` applies the Windows IME compatibility patch against xterm.js 6.0.0. Review the patch and its UI coverage when updating xterm.

## Development and validation

- `npm ci` installs dependencies. `npm start` builds and starts Electron.
- `npm test` runs Node tests for local shells, SSH configuration, and the SSH protocol against local fixtures.
- `npm run test:ui` builds the renderer and runs the Playwright Electron suite with isolated app data, SSH configuration, and a loopback SSH server. Screenshots and results go to `test-results/`.
- `npm run pack` creates the Windows portable directory under `release/`. `npm run dist` also creates the Windows ZIP.
- See `README.md` for supported behavior and `VALIDATION.md` for previous test results and platform-specific coverage.
