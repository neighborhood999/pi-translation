import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** A clipboard acquisition result that keeps expected failures explicit. */
export type ClipboardReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'empty' };

type ClipboardRuntimeFacts = {
  readonly platform: NodeJS.Platform;
  readonly hasWaylandDisplay: boolean;
  readonly hasX11Display: boolean;
};

type ClipboardAdapter = (
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
) => Promise<string | undefined>;

const CLIPBOARD_TIMEOUT_MS = 5_000;

/** Read copied text using the first eligible platform clipboard command. */
export async function readClipboardText(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
  runtimeFacts: ClipboardRuntimeFacts = detectClipboardRuntimeFacts(),
): Promise<ClipboardReadResult> {
  for (const adapter of selectClipboardAdapters(runtimeFacts)) {
    const output = await adapter(pi, cwd);
    if (output === undefined) {
      continue;
    }

    const text = normalizeClipboardText(output);
    return text.trim().length > 0 ? { ok: true, text } : { ok: false, reason: 'empty' };
  }

  return { ok: false, reason: 'unavailable' };
}

function detectClipboardRuntimeFacts(): ClipboardRuntimeFacts {
  return {
    platform: process.platform,
    hasWaylandDisplay: Boolean(process.env.WAYLAND_DISPLAY),
    hasX11Display: Boolean(process.env.DISPLAY),
  };
}

async function execClipboardCommand(
  pi: Pick<ExtensionAPI, 'exec'>,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    const result = await pi.exec(command, [...args], {
      cwd,
      timeout: CLIPBOARD_TIMEOUT_MS,
    });
    return result.code === 0 && !result.killed ? result.stdout : undefined;
  } catch {
    return undefined;
  }
}

function selectClipboardAdapters(
  runtimeFacts: ClipboardRuntimeFacts,
): ReadonlyArray<ClipboardAdapter> {
  switch (runtimeFacts.platform) {
    case 'darwin':
      return [macOsClipboardAdapter];
    case 'win32':
      return [windowsClipboardAdapter];
    case 'linux':
      return [
        ...(runtimeFacts.hasWaylandDisplay ? [waylandClipboardAdapter] : []),
        ...(runtimeFacts.hasX11Display ? [xclipClipboardAdapter, xselClipboardAdapter] : []),
      ];
    default:
      return [];
  }
}

function macOsClipboardAdapter(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
): Promise<string | undefined> {
  return execClipboardCommand(pi, 'pbpaste', [], cwd);
}

function windowsClipboardAdapter(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
): Promise<string | undefined> {
  return execClipboardCommand(
    pi,
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw -Format Text',
    ],
    cwd,
  );
}

function waylandClipboardAdapter(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
): Promise<string | undefined> {
  return execClipboardCommand(pi, 'wl-paste', ['--no-newline', '--type', 'text'], cwd);
}

function xclipClipboardAdapter(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
): Promise<string | undefined> {
  return execClipboardCommand(pi, 'xclip', ['-selection', 'clipboard', '-out'], cwd);
}

function xselClipboardAdapter(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
): Promise<string | undefined> {
  return execClipboardCommand(pi, 'xsel', ['--clipboard', '--output'], cwd);
}

function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/u, '');
}
