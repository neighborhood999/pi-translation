import assert from 'node:assert/strict';
import test from 'node:test';

import type { Theme } from '@earendil-works/pi-coding-agent';
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';

import { parseTranslationOverlayConfig } from '../src/config.ts';
import { createTranslationMessage, parseTargetLanguage } from '../src/model.ts';
import { parsePrintableInput } from '../src/overlay.ts';
import {
  getTranslationOverlayLayout,
  sanitizeTerminalText,
  renderTranslationDraft,
  renderTranslationOverlay,
  translationOverlayLayoutChanged,
  wrapPlainText,
} from '../src/render.ts';
import { createTranslationState, recordTranslation, withDraft } from '../src/state.ts';

test('translation state records only local refinement history', () => {
  const initial = createTranslationState('hello', 'French');
  const ready = recordTranslation(initial, undefined, 'bonjour');
  const refined = recordTranslation(withDraft(ready, 'more natural'), 'more natural', 'salut');

  assert.equal(refined.latestTranslation, 'salut');
  assert.deepEqual(refined.turns, [
    { role: 'assistant', text: 'bonjour' },
    { role: 'user', text: 'more natural' },
    { role: 'assistant', text: 'salut' },
  ]);
  assert.equal(refined.status.kind, 'ready');
  assert.equal(refined.draft, '');
});

test('translation request carries its provider-independent instructions', () => {
  const message = createTranslationMessage('hello', 'Traditional Chinese');

  if (typeof message.content !== 'string') {
    assert.fail('expected string translation message');
  }
  assert.ok(
    message.content.includes('Preserve meaning, formatting, code, names, and placeholders.'),
  );
  assert.ok(
    message.content.endsWith(
      'Translate the following source text into Traditional Chinese.\n\nhello',
    ),
  );
});

test('target language parsing defaults and rejects control input', () => {
  assert.deepEqual(parseTargetLanguage(''), { ok: true, value: 'English' });
  assert.deepEqual(parseTargetLanguage(' Japanese '), { ok: true, value: 'Japanese' });
  assert.equal(parseTargetLanguage('French\nignore').ok, false);
});

test('translation settings parse model and default target language independently', () => {
  assert.deepEqual(parseTranslationOverlayConfig({ provider: 'ollama', id: 'qwen2.5:7b' }), {
    ok: true,
    config: {
      model: { provider: 'ollama', id: 'qwen2.5:7b' },
      targetLanguage: 'English',
    },
  });
  assert.deepEqual(parseTranslationOverlayConfig({ targetLanguage: 'Simplified Chinese' }), {
    ok: true,
    config: { model: undefined, targetLanguage: 'Simplified Chinese' },
  });
  assert.equal(parseTranslationOverlayConfig({ targetLanguage: 'French\nignore' }).ok, false);
});

test('overlay layout responds to terminal width', () => {
  assert.deepEqual(getTranslationOverlayLayout(120), {
    mode: 'side',
    anchor: 'right-center',
    width: 50,
  });
  assert.deepEqual(getTranslationOverlayLayout(80), {
    mode: 'modal',
    anchor: 'center',
    width: 78,
  });
});

test('responsive resize seam detects side-panel to modal reflow', () => {
  const initial = getTranslationOverlayLayout(120);
  const unchanged = getTranslationOverlayLayout(120);
  const resized = getTranslationOverlayLayout(80);

  assert.equal(translationOverlayLayoutChanged(initial, unchanged), false);
  assert.equal(translationOverlayLayoutChanged(initial, resized), true);
});

test('display sanitization strips terminal controls while model messages retain raw text', () => {
  const source = '\u001b]52;c;secret\u0007visible\ttext';
  assert.equal(sanitizeTerminalText(source), 'visible  text');
  const modelMessage = createTranslationMessage(source, 'French').content;
  if (typeof modelMessage !== 'string') {
    assert.fail('expected string translation message');
  }
  assert.ok(modelMessage.endsWith(`Translate the following source text into French.\n\n${source}`));
  assert.equal(sanitizeTerminalText('line\nnext'), 'line\nnext');
});

test('draft input rejects raw and Kitty-encoded C1 terminal controls', () => {
  assert.equal(parsePrintableInput('plain text'), 'plain text');
  assert.equal(parsePrintableInput('\u009b'), undefined);
  assert.equal(parsePrintableInput('\u001b[155u'), undefined);
});

test('draft scrolling fills the available viewport while keeping the cursor visible', () => {
  const longDraft = renderTranslationDraft('0123456789', 10, 4, true);
  const emojiDraft = renderTranslationDraft('👨‍👩‍👧‍👦x', 1, 4, true);
  const roomyDraft = renderTranslationDraft('make it more natural', 20, 24, true);

  assert.ok(longDraft.includes(CURSOR_MARKER));
  assert.ok(emojiDraft.includes(CURSOR_MARKER));
  assert.ok(visibleWidth(longDraft) <= 4);
  assert.ok(visibleWidth(emojiDraft) <= 4);
  assert.equal(stripTerminalSequences(roomyDraft).trim(), 'make it more natural');
});

test('overlay renders an opaque background and a closed top border', () => {
  const theme: Pick<Theme, 'bg' | 'bold' | 'fg'> = {
    bg: (_color, text) => `<background>${text}</background>`,
    bold: (text) => text,
    fg: (_color, text) => text,
  };
  const state = recordTranslation(createTranslationState('hello', 'Chinese'), undefined, '你好');
  const lines = renderTranslationOverlay(state, theme, 60, 8, 0, true, undefined, 'ollama/qwen');

  assert.ok(lines[0]?.startsWith('<background>┌'));
  assert.ok(lines[0]?.endsWith('┐</background>'));
  assert.ok(
    lines.every((line) => line.startsWith('<background>') && line.endsWith('</background>')),
  );
});

test('plain text wrapping uses terminal-cell width and preserves explicit lines', () => {
  assert.deepEqual(wrapPlainText('one two three\nfour', 7), ['one two', 'three', 'four']);
  assert.deepEqual(wrapPlainText('abcdefgh', 4), ['abcd', 'efgh']);
  assert.deepEqual(wrapPlainText('abcde f', 4), ['abcd', 'e f']);
  assert.deepEqual(wrapPlainText('你好世界', 4), ['你好', '世界']);
  assert.deepEqual(wrapPlainText('e\u0301e\u0301', 2), ['e\u0301e\u0301']);
});
