# Terminal

Terminal is an Electron and xterm.js desktop terminal for local Bash and Zsh sessions and SSH connections to Linux hosts.

## Getting started

Development requires Node.js 22.12 or later. Linux builds also require a C/C++ toolchain, make, and Python to compile `node-pty`. A portable build is available for Windows x64.

```sh
cd Terminal
npm ci
npm start
```

On Windows, `npm run pack` produces `release/Terminal-<version>/Terminal.exe` alongside its runtime files. `npm run dist` also creates a distributable ZIP. Extract the entire directory and launch the executable from there. The first development run downloads Electron. The portable build stores settings in the current user's application data directory. The app and its shortcuts display the Terminal name and supplied icon. Packaging embeds a multi-size Windows ICO. Terminal reuses an existing settings directory from earlier releases when it finds one, preserving connection profiles, fonts, and host fingerprints.

## Language

Terminal opens in English by default, regardless of the system language. To use Simplified Chinese, open **Settings**, select it under **Language**, and save. The interface updates immediately and remembers your choice.

## Local terminals

Click **+ Local Terminal** in the header or **Open Local Terminal** on the home screen, then choose Bash or Zsh. The shell starts in your home directory and reads its interactive configuration. Local and SSH tabs share fonts, themes, search, clipboard shortcuts, and the Markdown reader. Type `exit` to close a local tab.

- Linux and macOS use Bash or Zsh installed on your `PATH`.
- Windows uses the default WSL distribution. Install WSL and the shell you intend to use in that distribution.

## Tabs, groups, and split view

- Drag tab labels left or right to reorder tabs. **Ctrl+Tab** follows the displayed order. A tab's **⋯** menu also has **Move Earlier** and **Move Later**.
- Open **⋯** or right-click a tab to create a named group or add the tab to an existing group. Tab groups support SSH sessions and local shells. Choose **No Group** to remove one tab. Click a group name to rename or ungroup it, or drag its label to move the whole group.
- Choose **Split View**, select two or more open tabs, then choose **Side by Side** or **Stacked**. Drag a divider to resize neighboring panes. With a divider focused, use the corresponding arrow keys to resize it.
- Click a pane to direct input and toolbar actions to it. Selecting a tab outside the split replaces the focused pane. **Return to Single View** shows the focused tab. Split changes preserve open sessions and their scrollback.

## Themes and color schemes

Open **Appearance** to choose a UI theme and terminal color scheme. The preview includes a multilingual font sample, emoji, and all 16 ANSI colors. Apply the selection with **Save Appearance**, or dismiss the preview with **Cancel**.

The eight UI themes are Midnight, Graphite, Deep Sea, Forest, Plum, Paper, Sand, and High Contrast. **Follow System** adapts the light or dark UI to the operating system. Themes cover the tabs, toolbar, forms, search, reading panel, and notifications.

The twelve terminal schemes are Mint Night, Graphite Gold, Ocean Blue, Forest Green, Nebula, Ember, Glacier, Phosphor Green, Paper, Sepia, Celadon, and High Contrast. Pick a scheme independently or select **Follow UI Theme**. Saving updates existing tabs and new connections in place and preserves their scrollback. Theme choices persist across restarts and remain independent of font and performance settings.

Schemes control the background, foreground, cursor, selection, and the 16 ANSI colors. xterm handles other colors, including explicit 24-bit RGB values from the remote program. If an application uses fixed light-colored text, choose a compatible terminal scheme or adjust the application's colors.

Theme definitions are in `src/themes.js`, UI style tokens are in `src/themes.css`, and localized theme names are in `i18n/`.

## Fonts and character widths

In **Settings**, enter each font chain as comma-separated names without quotes.

| Use | Default order |
| --- | --- |
| English, digits, and Latin characters | Comic Mono, Consolas |
| Chinese and other CJK characters | NSimSun, SimSun |
| Greek letters and mathematical symbols | Cambria Math, STIX Two Math, Segoe UI Symbol |
| Emoji | Segoe UI Emoji, Noto Color Emoji |
| Other characters | Consolas, NSimSun, Segoe UI Symbol, monospace |

Terminal creates `@font-face local()` aliases with `unicode-range` rules to direct each script or symbol group to its own fallback chain. A global fallback covers remaining glyphs. The app uses fonts already installed on the system.

Terminal measures local fonts against the Latin cell width, using Comic Mono when available, and uses `size-adjust` to calibrate CJK characters and emoji. In the xterm grid, English occupies one cell, CJK and complete emoji graphemes occupy two, and Greek letters and common math symbols occupy one. Settings shows alignment and reports whether the preferred fonts loaded. Visible glyph width can differ from the number of grid cells a character occupies. Settings from older versions migrate the default Latin and CJK fonts once to Comic Mono and NSimSun, then retain user changes.

The experimental xterm Unicode 15 grapheme addon is enabled by default to improve the widths of combined emoji such as 🧑‍💻. Switch to Unicode 11 for remote programs that use older `wcwidth` tables. Alignment still depends on the remote libc and application agreeing with the terminal's width rules. English ligatures use the terminal's standard behavior.

For Microsoft Pinyin, Terminal uses the text committed by the composition-end event. This preserves committed text when Windows Text Services Framework (TSF) replaces the entire hidden input field. The build applies the compatibility patch in `patches/xterm-ime.mjs` to the pinned xterm.js 6.0.0 sources. Application shortcuts yield during composition. The input path handles commit and cancel separately and sends only committed text over SSH. See [xterm.js issue #6049](https://github.com/xtermjs/xterm.js/issues/6049) and [pull request #6051](https://github.com/xtermjs/xterm.js/pull/6051).

## SSH

Terminal supports passwords, encrypted and unencrypted private keys, and the SSH agent. Saved connection profiles store the name, host, port, username, and authentication type. Credentials and private key contents stay in memory. Pick a private key from the file chooser for a manual connection, or use the `IdentityFile` in your SSH config. Agent authentication uses `SSH_AUTH_SOCK` and falls back to the OpenSSH agent named pipe on Windows.

Terminal reads the current user's `~/.ssh/config` when it starts and when you open the connection dialog. On Windows this file is typically `C:\Users\<username>\.ssh\config`. Select an alias in the `~/.ssh/config` group or type the alias and select **Use ~/.ssh/config** as the authentication method. Terminal rereads the file for each connection and treats it as read-only. **Refresh SSH Config** updates the host list immediately.

Supported directives and syntax include multiple `Host` aliases, wildcard and negated patterns, case-insensitive directive names, first-value precedence, `HostName`, `User`, `Port`, multiple `IdentityFile` entries, quoted paths with spaces, `~`, the common `%d/%h/%n/%p/%r` tokens, globbed `Include` paths, `IdentityAgent`, `IdentitiesOnly`, `PreferredAuthentications`, `ServerAliveInterval`, and `ConnectTimeout`. Relative `Include` paths resolve from the user's `.ssh` directory. The host list shows explicit aliases. For a wildcard rule, type an alias that matches it.

`ProxyJump` supports single and multiple hops, including chained jump hosts. Terminal verifies each host fingerprint and can use a separate `IdentityFile` for each hop. A password or passphrase entered in the connection form applies to each hop for that connection.

If key authentication fails and a server permits password login, Terminal prompts for the password for that host. Jump hosts and the destination authenticate separately. Keyboard-interactive challenges, including verification codes, are supported. Terminal can also prompt to unlock an encrypted key. Closing the session cancels outstanding prompts.

After a password dialog closes, Terminal blurs the password field, returns focus to the terminal's plain-text input, and restores Windows WebView focus when the app is in the foreground. This lets the existing input method resume with the system settings intact and without changing how the password is displayed.

Supported `Match` conditions are `all`, `host`, `originalhost`, `user`, and `localuser`. Terminal reports unsupported conditions such as `Match exec` and leaves their commands unexecuted. For jump hosts, use `ProxyJump`. General `ProxyCommand` execution, hardware-key interaction, system-wide `ssh_config`, algorithm overrides, port forwarding, and `RemoteCommand` are outside the current implementation.

On first connection, verify the server's SHA-256 host fingerprint before trusting it. Terminal prompts again if the host key changes. Trusted fingerprints live in `known-hosts.json` in Electron's `userData` directory. This trust store is independent of OpenSSH's `known_hosts`, and the verification prompt remains in place regardless of `StrictHostKeyChecking`.

## Vim, Codex CLI, and Claude CLI

SSH opens a remote PTY using `TERM=xterm-256color`. Terminal also requests `COLORTERM=truecolor` and `TERM_PROGRAM=SilkTerminal`, which the server may reject. The terminal supports 16 and 256 ANSI colors, 24-bit color, the alternate screen, cursor styles, application cursor keys, mouse reporting, bracketed paste, and Unicode. Vim and Neovim receive their usual keys, including Ctrl+C, Ctrl+W, Escape, Alt, and vi commands. Hold Shift to select text when a TUI captures the mouse.

A remote shell exit, channel EOF, or SSH disconnection automatically closes its tab. Closing a background tab keeps the current tab active. Closing the current tab selects a neighbor. When the last tab closes, Terminal returns to the home screen. It shows connection errors in a notification and asks for confirmation when you manually close an active session.

Install and launch Codex CLI and Claude CLI on the remote host as usual. Terminal provides generic terminal protocol support. End-to-end compatibility with Vim, Codex CLI, and Claude CLI on real Linux hosts remains unverified. For multiline input, use the application's own shortcuts, such as backslash followed by Enter in Claude, or use paste. Test complex tmux and emoji layouts against your remote configuration. Terminal sends input only while connected. For long-running tasks, you can use tmux on the host and resume with **Reconnect**.

## Markdown reader

Select Markdown in a terminal and open **Markdown Reader**. With no selection, the reader takes up to 4,000 recent lines or 500,000 characters from the current buffer and joins soft wraps. It supports headings, lists, code blocks, tables, and quotations. You can edit the source text or refresh it manually. To read a file, print it in the terminal, for example with `cat README.md`.

DOMPurify sanitizes the rendered HTML. The reader blocks scripts, images, embedded content, and external link navigation. Markdown parsing runs on demand in the reading panel, leaving the interactive terminal in its VT grid.

## LaTeX math

The reader renders `$...$` and `\(...\)` inline and `$$...$$` and `\[...\]` as display math. KaTeX supports Greek letters, fractions, scripts, integrals, sums, and matrices.

```latex
Inline: $\alpha+\beta=\gamma$

$$
\int_0^\infty e^{-x}\,dx=1
\qquad \begin{pmatrix}a&b\\c&d\end{pmatrix}
$$
```

Rendered math uses the bundled KaTeX fonts. Greek letters in the terminal grid use the Cambria Math chain. Code blocks, inline code, and the terminal grid display the original LaTeX source.

KaTeX and its fonts load on demand from the app bundle. The renderer disables trusted commands and external resources, limits macro expansion and formula size, and allows up to 500 formulas per snapshot and 8,192 characters per formula. Invalid expressions are displayed as source.

## Performance

- The default scrollback is 50,000 lines per session, configurable from 1,000 to 500,000. Older lines roll off when the buffer fills. Actual memory use depends on line width, color attributes, and the number of tabs. Terminal supports up to 24 concurrent sessions.
- SSH and local PTYs pause output after sending each batch. They resume when xterm finishes parsing it and acknowledges the sequence number. UTF-8 decoding preserves split characters across chunks.
- Each tab retains its own xterm instance and buffer. Hidden tabs stop visible drawing and continue parsing output, which can still use CPU under a heavy workload.
- The default DOM renderer avoids WebGL context and texture overhead. With WebGL enabled, only the focused tab holds a context. Other visible panes use DOM. Changing focus releases the previous context and rebuilds the glyph atlas when needed. If initialization fails or the context is lost, Terminal falls back to DOM.
- By default, cursor blinking, smooth scrolling, and transparency are off. Terminal throttles resize events and avoids background resource polling.
- Each input or paste is limited to 1 MiB. When the SSH input queue exceeds 2 MiB, Terminal drops the new input and shows a notification.
- Electron has a baseline Chromium resource cost. The current release keeps scrollback in memory and bounds its size.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T | New SSH connection |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Shift+W | Close the tab, with confirmation for active sessions |
| Ctrl+Shift+F | Search scrollback. Enter finds the next result, Shift+Enter finds the previous one |
| Ctrl+Shift+M | Markdown reader |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy selection / paste |
| Right-click | Copy and clear a selection, or paste if nothing is selected |
| Ctrl+C | Copy a selection, or send the interrupt key if nothing is selected |

The terminal handles right-click locally. If a TUI captures the mouse, Shift+drag selects text for right-click to copy. Paste honors xterm's bracketed paste mode when the receiving program enables it and keeps the 1 MiB limit.

## Validation

```sh
npm test
npm run test:ui
npm audit
```

`npm test` covers local shells and tests SSH against a loopback ssh2 server. SSH coverage includes PTYs, terminal input, UTF-8 and truecolor output, resizing, output acknowledgments, a 30,000-line transfer, untrusted host rejection, and cleanup.

`npm run test:ui` launches Electron with isolated settings and a loopback SSH service. It tests local and SSH tabs, multilingual fonts, Markdown sanitization, a 30,000-line transfer, tab switching, background output, the alternate screen, DOM fallback, and language settings. Only the test process automatically trusts the fixture host key. Screenshots and measurements are saved in `test-results/`. The measurements include automation delays.

See [xterm.js flow control](https://xtermjs.org/docs/guides/flowcontrol/), [xterm.js terminal options](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/), the [Electron security guide](https://www.electronjs.org/docs/latest/tutorial/security/), and [ssh2](https://github.com/mscdex/ssh2).
