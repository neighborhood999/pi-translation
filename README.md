# pi-translation

[![CI](https://github.com/neighborhood999/pi-translation/actions/workflows/ci.yml/badge.svg)](https://github.com/neighborhood999/pi-translation/actions/workflows/ci.yml)

<img src="./screenshot.png" alt="pi-translation-screenshot" />

Clipboard-first translation workspace for Pi. The overlay keeps its conversation separate from the active Pi session while sending translation requests through a selected model provider.

## Install

Install the extension directly from GitHub:

```sh
pi install git:github.com/neighborhood999/pi-translation
```

For a reproducible installation, use a tagged release:

```sh
pi install git:github.com/neighborhood999/pi-translation
```

To try the extension for one Pi process without adding it to your settings:

```sh
pi -e git:github.com/neighborhood999/pi-translation
```

Restart Pi or run `/reload` in an already running interactive Pi session. To upgrade a pinned installation, install the desired newer tag explicitly.

### Local development installation

This standalone pnpm package declares the Pi extension entry point as `./src/index.ts`. Install dependencies, then install the package from its checkout:

```sh
pnpm install
pi install /absolute/path/to/pi-translation
```

The runtime Pi core imports are peer dependencies supplied by Pi. The `devDependencies` are used for local typechecking, linting, formatting, and tests only; `node_modules` must not be committed.

Preferences are stored in `~/.pi/agent/translation.json`, or in the directory selected by `PI_CODING_AGENT_DIR`. That file is not part of this repository.

## Usage

1. Select terminal text and copy it.
2. Run `/translate` in Pi. The extension selects a clipboard command for the current platform and desktop session.
3. Optionally choose a target language for one request with `/translate <language>`, for example `/translate Japanese`. Without an argument, `/translate` uses the configured default.
4. Set that default interactively with `/translate-language`, or directly with `/translate-language Traditional Chinese`.
5. Type a refinement and press **Enter**. Requests such as `more natural`, `formal`, `explain`, and `alternatives` can be used for follow-up turns.

The **Ctrl+Alt+T** shortcut opens the workspace from the clipboard using the configured target language.

After installation, use the platform smoke-test matrix below. On every platform, copy a short phrase, press **Ctrl+Alt+T**, and confirm a translation appears in the configured target language. Then enter `more natural`, press **Enter**, try **Ctrl+Y** and **Ctrl+I**, and close with **Esc**.

## Translation model

Run `/translate-model` to choose a model used only by this extension. Models with configured authentication are listed cheapest-first using their declared input and output prices. Choose **Use current Pi model (default)** to follow Pi's active model again. `/translate-model` may therefore select a dedicated translation model without changing the main conversation's model.

Example with a local Qwen model and Traditional Chinese as the default target:

```json
{
  "provider": "ollama",
  "id": "qwen2.5:7b",
  "targetLanguage": "Traditional Chinese"
}
```

The chosen model appears in the overlay header. Changing the translation model does not change the main conversation's model.

## Overlay controls

- **Enter** — send a refinement
- **Ctrl+Y** — copy the latest translation
- **Ctrl+I** — insert the latest translation into Pi's main editor
- **Esc** or **Ctrl+C** — cancel in-flight work and close/discard

The workspace is a right-side panel on wide terminals and a centered, nearly full-width modal on narrow terminals. Source text and target language remain visible in both layouts.

## Isolation and privacy

The extension keeps its model messages in the overlay and does not add translator turns to Pi's session-message or persistence APIs. Closing the overlay discards that in-memory message history; translation content is not persisted in Pi's session by this extension.

Isolation does not prevent network or provider-side handling: requests go to the selected model provider, and that provider's logging, retention, privacy, and data-handling policy applies. Do not assume that provider-side content is not logged. The extension itself does not intentionally log clipboard, source, or translation text.

## Compatibility and limitations

- Tested with Pi **0.84.4** for noninteractive extension loading and `/translate` command dispatch.
- GitHub Actions runs installation, formatting, linting, typechecking, and automated tests on macOS, Ubuntu Linux, and Windows. Automated tests cover command selection and pure helpers, not interactive TUI behavior, model completion, session isolation, or real clipboard integration.
- The Pi overlay API used here is experimental and may change in later releases.
- Clipboard support is command-based and runtime-dependent. macOS uses `pbpaste`; Windows uses `powershell.exe` and `Get-Clipboard -Raw -Format Text`; Linux uses `wl-paste --no-newline --type text` on Wayland and `xclip -selection clipboard -out` or `xsel --clipboard --output` on X11.
- Windows and Linux clipboard support remain experimental. Cross-platform CI confirms that the extension installs and its automated checks pass on each operating system, but compatibility has not been established in interactive desktop sessions; automated tests mock command execution and do not claim stable clipboard compatibility.
- Linux chooses `wl-paste` first when both Wayland and X11 are available, then falls back to `xclip` and `xsel`. A rejected command, nonzero exit, or killed process permits the next eligible adapter; successful empty output is reported as empty without fallback.
- Clipboard commands run on the host where Pi runs and use that process's desktop-session environment. An SSH session does not bridge the clipboard: remote Pi reads a remote clipboard, not the local workstation's clipboard. Run Pi locally to read the local clipboard.
- Headless Linux has no eligible clipboard adapter unless a supported Wayland/X11 session and its environment are actually available; `/translate` reports the clipboard as unavailable.
- WSL is detected as Linux, not Windows. It therefore requires a Linux clipboard utility plus usable `WAYLAND_DISPLAY` or `DISPLAY`; Windows clipboard sharing is not automatic or supported by this adapter.
- Pi cannot read an arbitrary terminal selection directly; the selection must be copied first. Clipboard content is text-only; image, HTML, rich-text, and other non-text formats are unsupported or may be unavailable/lossy.
- There is no extension-level clipboard size limit, but very large content can be slow, consume memory, exceed the selected model's context, or increase provider costs.
- **Ctrl+Alt+T** may conflict with a desktop environment, window manager, terminal, or another Pi extension. Rebind the conflicting shortcut or use `/translate` instead.
- `/translate` without an argument and **Ctrl+Alt+T** use the configured target language. Close and reopen the workspace with another `/translate <language>` argument to change a single request's target.

### Linux prerequisites and status

Linux clipboard reading is experimental. Wayland requires `wl-paste` from `wl-clipboard` and a set `WAYLAND_DISPLAY`; X11 requires `xclip` or `xsel` and a set `DISPLAY`. When both sessions are present, the extension tries Wayland first and uses X11 only when the Wayland command fails. A headless Linux host, or a session without its display environment forwarded into Pi, is unavailable.

### Windows status

Windows clipboard reading is experimental. It requires `powershell.exe` and the built-in `Get-Clipboard` command. Validate it on the target Windows host before relying on it.

### Non-goals

- Installing or bundling clipboard utilities.
- Providing a native clipboard library or a per-platform integration package.
- Reading an un-copied terminal selection.
- Claiming reliable clipboard support for a desktop session or operating system without real-host validation.

### Manual real-host validation matrix

For each supported host, run the normal smoke test with short text, then repeat the cases below. The clipboard must be copied before each `/translate` or **Ctrl+Alt+T** attempt.

| Host/session        | Prerequisites                        | Expected command path                                               | Real-host cases                                                                  |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| macOS               | `pbpaste`                            | `pbpaste`                                                           | Unicode, multiline, empty, missing-tool, and non-text                            |
| Windows             | `powershell.exe` and `Get-Clipboard` | PowerShell adapter (experimental)                                   | Unicode, multiline, empty, missing-tool, and non-text                            |
| Linux Wayland       | `wl-clipboard`, `WAYLAND_DISPLAY`    | `wl-paste --no-newline --type text`                                 | Unicode, multiline, empty, missing-tool, and non-text                            |
| Linux X11           | `DISPLAY` and `xclip` or `xsel`      | `xclip -selection clipboard -out`, then `xsel --clipboard --output` | Unicode, multiline, empty, missing-tool, and non-text                            |
| Linux Wayland + X11 | Both sets above                      | Wayland first, then X11 fallback after a Wayland failure            | Unicode, multiline, empty, missing-tool, non-text, and fallback                  |
| Headless Linux      | No desktop clipboard session         | No command                                                          | unavailable result; no command should be attempted                               |
| WSL                 | Linux utility and forwarded display  | Linux adapter selected by available display                         | Unicode, multiline, empty, missing-tool, non-text; no automatic Windows fallback |
| Pi over SSH         | Clipboard on local and remote hosts  | Commands run where Pi runs                                          | confirm remote clipboard is used and local clipboard is not bridged              |

For the **missing-tool** cases, temporarily remove or rename the selected utility from `PATH` and expect `unavailable` (or the next eligible X11 fallback). For **fallback**, make `wl-paste` fail while both displays are available and expect X11; make `xclip` fail and expect `xsel`. For **empty**, clear the clipboard and expect the empty result without trying another adapter. For **non-text**, copy an image, HTML, or rich-text item and expect unsupported/unavailable or text-only output rather than image/rich-text preservation. Confirm Unicode and multiline content is returned without corruption.

Windows and Linux clipboard rows require validation in interactive desktop sessions; cross-platform CI and mocked tests alone do not establish clipboard compatibility.

## Development

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

`pnpm check` runs formatting checks, linting with warnings denied, TypeScript checking, and the test suite.
