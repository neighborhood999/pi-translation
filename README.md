# pi-translation

[![CI](https://github.com/neighborhood999/pi-translation/actions/workflows/ci.yml/badge.svg)](https://github.com/neighborhood999/pi-translation/actions/workflows/ci.yml)

<img src="./screenshot.png" alt="pi-translation screenshot" />

A clipboard-first translation workspace for Pi. Translation conversations stay separate from the active Pi session.

## Install

```sh
pi install git:github.com/neighborhood999/pi-translation
```

Restart Pi or run `/reload`. To try the extension without installing it:

```sh
pi -e git:github.com/neighborhood999/pi-translation
```

### Local development

```sh
pnpm install
pi install /absolute/path/to/pi-translation
```

Preferences are stored in `~/.pi/agent/translation.json`, or under `PI_CODING_AGENT_DIR` when set.

## Usage

1. Copy text to the clipboard.
2. Run `/translate`, or press **Ctrl+Alt+T**.
3. Type a refinement such as `more natural`, `formal`, `explain`, or `alternatives`, then press **Enter**.

Use `/translate <language>` for a one-time target, for example `/translate Japanese`. Set the default with `/translate-language [language]`.

### Controls

- **Enter** — send a refinement
- **Ctrl+Y** — copy the latest translation
- **Ctrl+I** — insert it into Pi's editor
- **Esc** or **Ctrl+C** — cancel and close

The workspace appears as a right panel on wide terminals and a centered modal on narrow terminals.

## Translation model

Run `/translate-model` to select a model for translations only. Authenticated models are listed cheapest-first. Select **Use current Pi model (default)** to follow Pi's active model.

Example configuration:

```json
{
  "provider": "ollama",
  "id": "qwen2.5:7b",
  "targetLanguage": "Traditional Chinese"
}
```

Changing this model does not affect Pi's main conversation.

## Privacy

Translation messages remain in the overlay and are discarded when it closes; the extension does not persist them in Pi's session or intentionally log clipboard or translation text.

Requests still go to the selected model provider and are subject to that provider's logging, retention, and privacy policies.

## Clipboard support

Clipboard commands run on the machine where Pi runs:

| Platform | Requirement | Command |
| --- | --- | --- |
| macOS | `pbpaste` | `pbpaste` |
| Windows | PowerShell | `Get-Clipboard -Raw -Format Text` |
| Linux Wayland | `wl-clipboard`, `WAYLAND_DISPLAY` | `wl-paste --no-newline --type text` |
| Linux X11 | `DISPLAY`, `xclip` or `xsel` | `xclip`, then `xsel` |

Windows and Linux support is experimental. Linux tries Wayland first, then X11 after a failure. Headless Linux has no clipboard adapter. WSL requires a Linux clipboard utility and a usable display; it does not automatically use the Windows clipboard.

An SSH session reads the remote host's clipboard, not your local clipboard. Pi cannot read a terminal selection until you copy it. Only text is supported.

**Ctrl+Alt+T** may conflict with terminal or desktop shortcuts; use `/translate` instead if needed.

## Compatibility

- Tested with Pi **0.84.4**.
- CI runs installation, formatting, linting, typechecking, and tests on macOS, Linux, and Windows.
- Clipboard commands and interactive TUI behavior require real-host testing.
- Pi's overlay API is experimental and may change.

### Smoke test

Copy a short phrase, run `/translate` or press **Ctrl+Alt+T**, and verify the target language. Then submit `more natural`, test **Ctrl+Y** and **Ctrl+I**, and close with **Esc**.

## Development

```sh
pnpm check
```

This checks formatting, linting, types, and tests. Individual commands are `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
