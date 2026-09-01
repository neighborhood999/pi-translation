import type { Theme } from '@earendil-works/pi-coding-agent';
import {
  CURSOR_MARKER,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';

import type { TranslationState } from './state.ts';

type TranslationOverlayTheme = Pick<Theme, 'bg' | 'bold' | 'fg'>;

/** Responsive placement and width for the translation workspace. */
export type TranslationOverlayLayout = {
  readonly mode: 'side' | 'modal';
  readonly anchor: 'right-center' | 'center';
  readonly width: number;
};

/** Select a side panel for wide terminals and a nearly full-width modal otherwise. */
export function getTranslationOverlayLayout(terminalWidth: number): TranslationOverlayLayout {
  const width = Math.max(10, Math.floor(terminalWidth));
  if (width >= 100) {
    return { mode: 'side', anchor: 'right-center', width: Math.max(42, Math.floor(width * 0.42)) };
  }
  return { mode: 'modal', anchor: 'center', width: Math.max(10, width - 2) };
}

/** Return whether a live overlay must be reopened for the current terminal layout. */
export function translationOverlayLayoutChanged(
  initial: TranslationOverlayLayout,
  current: TranslationOverlayLayout,
): boolean {
  return (
    initial.mode !== current.mode ||
    initial.anchor !== current.anchor ||
    initial.width !== current.width
  );
}

/** Remove terminal control sequences before untrusted text reaches the renderer. */
export function sanitizeTerminalText(text: string): string {
  return Array.from(stripTerminalSequences(text), (character) => {
    if (character === '\t') {
      return '  ';
    }
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && isTerminalControl(codePoint) ? ' ' : character;
  }).join('');
}

function isTerminalControl(codePoint: number): boolean {
  return (
    (codePoint >= 0 && codePoint <= 8) ||
    (codePoint >= 11 && codePoint <= 12) ||
    (codePoint >= 14 && codePoint <= 31) ||
    (codePoint >= 127 && codePoint <= 159)
  );
}

/** Wrap plain text by terminal-cell width for display. */
export function wrapPlainText(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, Math.max(1, Math.floor(width)));
}

/** Render the isolated translation workspace as terminal lines. */
export function renderTranslationOverlay(
  state: TranslationState,
  theme: TranslationOverlayTheme,
  width: number,
  maxBodyLines: number,
  cursor: number,
  focused: boolean,
  notice: string | undefined,
  modelLabel: string,
): string[] {
  const totalWidth = Math.max(10, Math.floor(width));
  const innerWidth = Math.max(6, totalWidth - 2);
  const contentWidth = Math.max(4, innerWidth - 2);
  const body: string[] = [];
  const safeSource = sanitizeTerminalText(state.source);
  const safeTargetLanguage = sanitizeTerminalText(state.targetLanguage);
  const safeLatestTranslation = state.latestTranslation
    ? sanitizeTerminalText(state.latestTranslation)
    : undefined;
  const safeNotice = notice ? sanitizeTerminalText(notice) : undefined;
  const safeModelLabel = sanitizeTerminalText(modelLabel);

  body.push(theme.bold(theme.fg('accent', 'Source')));
  const sourceLines = wrapPlainText(safeSource, contentWidth);
  body.push(...sourceLines.slice(0, 4).map((line) => ` ${line}`));
  if (sourceLines.length > 4) {
    body.push(' …');
  }
  body.push('');

  body.push(theme.bold(theme.fg('accent', 'Latest translation')));
  if (safeLatestTranslation) {
    body.push(...wrapPlainText(safeLatestTranslation, contentWidth).map((line) => ` ${line}`));
  } else if (state.status.kind === 'loading') {
    body.push(` ${theme.fg('muted', 'Translating…')}`);
  } else {
    body.push(` ${theme.fg('dim', 'No translation yet')}`);
  }

  const previousTurns = state.turns.slice(0, -1);
  if (previousTurns.length > 0) {
    body.push('');
    body.push(theme.bold(theme.fg('muted', 'Conversation history')));
    for (const turn of previousTurns.slice(-4)) {
      const label = turn.role === 'user' ? 'You' : 'Previous';
      const text = sanitizeTerminalText(turn.text);
      body.push(...wrapPlainText(`${label}: ${text}`, contentWidth).map((line) => ` ${line}`));
    }
  }

  const visibleBody = body.slice(0, Math.max(0, maxBodyLines));
  if (body.length > visibleBody.length && visibleBody.length > 0) {
    visibleBody[visibleBody.length - 1] = ' …';
  }

  const lines: string[] = [
    topBorder(theme, ` ${theme.bold(theme.fg('accent', 'Translation workspace'))}`, innerWidth),
    borderLine(
      theme,
      ` ${theme.fg('muted', `Target: ${safeTargetLanguage} · Model: ${safeModelLabel}`)}`,
      innerWidth,
    ),
    divider(theme, innerWidth),
    ...visibleBody.map((line) => borderLine(theme, ` ${line}`, innerWidth)),
    divider(theme, innerWidth),
  ];

  const status =
    state.status.kind === 'loading'
      ? theme.fg('muted', '⏳ Working…')
      : state.status.kind === 'error'
        ? theme.fg('error', `⚠ ${sanitizeTerminalText(state.status.message)}`)
        : theme.fg('success', '✓ Ready');
  const statusWithNotice = safeNotice
    ? `${status} ${theme.fg('success', `· ${safeNotice}`)}`
    : status;
  lines.push(borderLine(theme, ` ${statusWithNotice}`, innerWidth));

  const draftPrefix =
    innerWidth >= 14 ? ` ${theme.fg('accent', 'Refine:')} ` : ` ${theme.fg('accent', '> ')} `;
  const draftWidth = Math.max(1, innerWidth - visibleWidth(draftPrefix));
  const draft = renderTranslationDraft(
    sanitizeTerminalText(state.draft),
    cursor,
    draftWidth,
    focused,
  );
  lines.push(borderLine(theme, `${draftPrefix}${draft}`, innerWidth));
  lines.push(
    borderLine(theme, ` ${theme.fg('dim', 'Enter send • Esc close • Ctrl+C cancel')}`, innerWidth),
  );
  lines.push(borderLine(theme, ` ${theme.fg('dim', 'Ctrl+Y copy • Ctrl+I insert')}`, innerWidth));
  lines.push(bottomBorder(theme, innerWidth));
  return lines.map((line) => theme.bg('customMessageBg', line));
}

/** Render a horizontally scrolled refinement draft while retaining the cursor marker. */
export function renderTranslationDraft(
  draft: string,
  cursor: number,
  width: number,
  focused: boolean,
): string {
  const characters = graphemes(draft);
  const safeCursor = Math.max(0, Math.min(cursor, characters.length));
  const maxWidth = Math.max(1, width);
  let start = 0;
  let end = characters.length;

  while (true) {
    const candidate = renderDraftWindow(characters, safeCursor, start, end, focused);
    const atMinimumWindow =
      start === safeCursor && end <= Math.min(characters.length, safeCursor + 1);
    if (visibleWidth(candidate) <= maxWidth || atMinimumWindow) {
      return candidate;
    }

    const leftWidth = visibleWidth(characters.slice(start, safeCursor).join(''));
    const rightWidth = visibleWidth(characters.slice(safeCursor + 1, end).join(''));
    if (start < safeCursor && (leftWidth >= rightWidth || end === safeCursor + 1)) {
      start += 1;
    } else if (end > safeCursor + 1) {
      end -= 1;
    } else if (start < safeCursor) {
      start += 1;
    } else {
      // A wide grapheme may exceed a one-cell viewport; keeping the marker is
      // more important than truncating the grapheme into an invalid cursor.
      return candidate;
    }
  }
}

function renderDraftWindow(
  characters: readonly string[],
  cursor: number,
  start: number,
  end: number,
  focused: boolean,
): string {
  const before = characters.slice(start, cursor).join('');
  const current = characters[cursor] ?? ' ';
  const after = characters.slice(cursor + 1, end).join('');
  const leftEllipsis = start > 0 ? '…' : '';
  const rightEllipsis = end < characters.length ? '…' : '';
  const marker = focused ? CURSOR_MARKER : '';
  return `${leftEllipsis}${before}${marker}\x1b[7m${current}\x1b[27m${after}${rightEllipsis}`;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(text), (part) => part.segment);
}

function topBorder(theme: TranslationOverlayTheme, content: string, innerWidth: number): string {
  return `${theme.fg('borderAccent', '┌')}${fitLine(content, innerWidth)}${theme.fg('borderAccent', '┐')}`;
}

function borderLine(theme: TranslationOverlayTheme, content: string, innerWidth: number): string {
  return `${theme.fg('borderAccent', '│')}${fitLine(content, innerWidth)}${theme.fg('borderAccent', '│')}`;
}

function divider(theme: TranslationOverlayTheme, innerWidth: number): string {
  return theme.fg('borderMuted', `├${'─'.repeat(innerWidth)}┤`);
}

function bottomBorder(theme: TranslationOverlayTheme, innerWidth: number): string {
  return theme.fg('borderAccent', `└${'─'.repeat(innerWidth)}┘`);
}

function fitLine(content: string, width: number): string {
  const truncated = truncateToWidth(content, width);
  return `${truncated}${' '.repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}
