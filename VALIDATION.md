# Validation history

## 0.3.1 Automatic tab closure when SSH ends

Terminal listens for remote channel EOF and close events, cleans up the SSH session, and tells the renderer to remove the tab. Cleanup is idempotent. A remote exit closes the tab automatically, and connection errors appear in a notification.

The protocol test sends EOF from a remote shell without waiting for the transport to close. It checks that the session is removed and the renderer receives exactly one close event. The Electron test covers background exits preserving focus, active exits selecting a neighbor, unexpected channel closure, return to the home screen after all tabs close, and creation of a new connection afterward. Existing theme, IME, password, and clipboard tests still run.

## 0.3.0 Themes and color schemes

This release adds eight UI themes, twelve terminal color schemes, system light and dark mode, independent scheme selection, and a preview before saving. The UI suite checks all twelve previews and their 16 ANSI swatches. It verifies that cancel preserves the current scheme, that a light scheme updates the rendered text color in five existing tabs, that the UI follows system mode, that the UI and terminal colors can be chosen independently, that applying a theme keeps SSH connected, and that saving font or performance settings preserves the color choices.

Light-reader and dark-picker screenshots were reviewed manually. They contained Chinese text, Comic Mono, emoji, LaTeX, and ANSI colors. Authentication, IME punctuation, clipboard, and large-output tests still run. Appearance uses the existing settings file and preserves existing font configuration.

## 0.2.4 Duplicate full-width punctuation

An Electron-to-SSH test reproduced a full-width comma being sent twice. The native input event and the delayed textarea diff in xterm's CompositionHelper each emitted one comma after an IME keydown and keyup with key code 229. The fixed path sends one comma.

An input generation counter invalidates stale diff work after a native input or composition event handles the insertion. The input handler checks the actual composition state. Pending composition commits are protected from duplicate input and keypress handling. Consecutive intentional presses of the same punctuation remain intact.

Tests cover full-width commas, periods, question marks, exclamation marks, colons, semicolons, parentheses, quotation marks, book-title marks, and enumeration commas. They exercise input between keydown and keyup, early keyup, early input, rapidly overlapping keys, compositionend and input together, and keypress and input together. The suite still covers Chinese and English input after password entry and copy and paste.

## 0.2.3 Input focus after password entry

This change addresses the reported case where English input worked after a password prompt but switching input methods did not. Terminal blurs the password control while it is still attached, clears and closes the dialog, focuses xterm's plain-text field, and reattaches the Windows text input client using `BrowserWindow.blurWebView` and `focusOnWebView`. It waits until the window is in the foreground before restoring native focus and leaves the user's input method selected.

The automated test submits the password with Enter, verifies that the field blurred while attached and that the WebView focus callback ran, then sends Chinese and English to the same SSH session. This adds native focus and composition coverage beyond the earlier DOM `activeElement` check. Manual verification of the user's specific Microsoft Pinyin configuration remains separate.

## 0.2.2 Microsoft Pinyin compatibility

The test reproduces a Windows TSF event sequence that replaces the value of a hidden textarea containing three spaces, then commits a two-character Chinese phrase. Under 0.2.1, Electron sent an empty string over SSH. With the patch, the remote side receives the full committed phrase once. The build patches pinned xterm.js 6.0.0 sources and fails if the expected version or source text changes.

Tests cover Chromium's native IME composition and commit, pending Pinyin staying local, cancelled compositions, Microsoft Pinyin's full-value replacement, different lengths of stale text, consecutive Chinese commits, Chinese with emoji, English candidate commits, and Enter or English input after composition. Password fallback, clipboard, 30,000-line output, font widths, and tab switching still run. These tests reproduce TSF event ordering. They leave Microsoft Pinyin versions on individual Windows machines for manual validation.

## 0.2.1 Authentication and clipboard fixes

An Electron integration test reproduced a jump host accepting a key while the destination rejected the default key and advertised password authentication. Terminal now falls back to a per-host password prompt for SSH config connections and handles keyboard-interactive prompts and encrypted key passphrases. The fixture used test credentials on a loopback SSH service.

The protocol and configuration suite had nine tests at this release. New coverage included password fallback when no default key was available, keyboard-interactive verification codes, and cleanup when authentication was cancelled. The Electron test connected using an SSH config alias and a test password from the prompt.

Clipboard handling was updated for Electron 45's asynchronous clipboard API. Tests use actual Shift+drag selection and the system clipboard to cover right-click copy and paste, Ctrl+C, Ctrl+Shift+C, toolbar copy, and bracketed paste. With TUI mouse reporting enabled, the right-click is still handled once. The suite backs up and restores existing clipboard formats in memory and leaves their contents out of logs.

## 0.2.0 Fonts, math, and SSH config

Six protocol and configuration tests passed. They covered `Host` patterns and negation, first-value precedence, case-insensitive directives, key paths containing spaces, unconditional and conditional `Include`, cycle detection, automatic key loading, an encrypted `IdentityFile` through a real `ProxyJump` connection, and host fingerprint checks at each hop. They used isolated temporary config and loopback fixtures.

Electron tests verified Comic Mono and NSimSun loading, a separate math font chain, one-cell English and Greek, and two-cell CJK and emoji. Tests sent text through SSH and used the terminal cursor-position response to verify that ZWJ emoji, flags, keycaps, and variation-selector hearts each occupy two columns. DOM tests also measured English, Chinese, and emoji layout with DOM ranges.

The reader was tested with all four LaTeX delimiters, inline and display formulas, Greek letters, fractions, superscripts and subscripts, integrals, sums, matrices, code spans, unsafe commands, and raw HTML style sanitization. Formula screenshots were reviewed manually. KaTeX fonts load from the application bundle, and Comic Mono, NSimSun, emoji fonts, and Cambria Math use locally installed fonts.

The UI suite also connected to a loopback SSH service through an alias in an isolated config file and retained testing for 30,000 lines of output, tab switching, alternate screen, and renderer modes. Measurements and screenshots are written to `test-results/`.

## 0.1.0 Baseline

The baseline was tested on November 22, 2026 on a Windows x64 workstation using Electron 45.4.1 and xterm.js 6.0.0.

The loopback SSH suite (`npm test`) and Electron UI suite (`npm run test:ui`) passed. The audit reported zero known vulnerabilities in the runtime and development dependencies at the time. The Electron binary was downloaded from a mirror and matched the SHA-256 checksum published with the npm package.

The full UI suite also passed against the portable executable at `release/Silk-Terminal-0.1.0/SilkTerminal.exe`, verifying packaged startup, runtime SSH dependencies, and resource paths.

The UI suite used a real ssh2 connection to a simulated remote PTY on loopback. Real Linux installations and Vim, Codex CLI, and Claude CLI remained outside that validation.

One automated workload transferred 30,000 lines and 3,360,020 bytes across a four-tab scenario with Chinese, emoji, colored output, background reception, alternate screen, font settings, and Markdown sanitization.

| Renderer | Output to snapshot | Typical tab click, including automation | First tab switch |
| --- | --- | --- | --- |
| WebGL | About 2.04 s | About 28–46 ms | About 114 ms |
| DOM | About 2.18 s | About 16–32 ms | About 145 ms |

These measurements include SSH transfer, terminal parsing, the Markdown snapshot, and Playwright scheduling. In this run, DOM had faster subsequent tab switches and a smaller GPU process working set, which informed the choice of default renderer. Results depend on hardware and sustained output.

After the workload, DOM working sets were about 106 MiB for the browser, 445 MiB for the tab, 324 MiB for the GPU process, and 46 MiB for the utility process. WebGL values were about 105, 471, 491, and 45 MiB. These figures include shared and transient pages. The suite took screenshots and allocated Markdown snapshots and test data. The first CPU sample returned zero, and dedicated GPU-memory and long-running CPU measurements were outside this run.

The suite writes detailed measurements to `test-results/report.json` and a screenshot to `test-results/terminal.png`. Git ignores these generated files.
