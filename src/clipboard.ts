import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** A clipboard acquisition result that keeps expected failures explicit. */
export type ClipboardReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'empty' };

/** Normalize terminal clipboard line endings without changing meaningful indentation. */
export function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/u, '');
}

/** Read copied text through the required macOS `pbpaste` command. */
export async function readClipboardText(
  pi: Pick<ExtensionAPI, 'exec'>,
  cwd: string,
): Promise<ClipboardReadResult> {
  try {
    const result = await pi.exec('pbpaste', [], { cwd, timeout: 5_000 });
    if (result.code !== 0 || result.killed) {
      return { ok: false, reason: 'unavailable' };
    }

    const text = normalizeClipboardText(result.stdout);
    return text.trim().length > 0 ? { ok: true, text } : { ok: false, reason: 'empty' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
