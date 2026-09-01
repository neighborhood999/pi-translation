import type { ModelRegistry, Theme } from '@earendil-works/pi-coding-agent';
import {
  Key,
  decodeKittyPrintable,
  matchesKey,
  type Component,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import type { Message } from '@earendil-works/pi-ai';

import {
  appendModelMessage,
  createRefinementMessage,
  createTranslationMessage,
  extractAssistantText,
  isUsableAssistantResponse,
  TRANSLATOR_SYSTEM_PROMPT,
  type TranslationModel,
} from './model.ts';
import {
  getTranslationOverlayLayout,
  renderTranslationOverlay,
  translationOverlayLayoutChanged,
  type TranslationOverlayLayout,
} from './render.ts';
import {
  beginTranslation,
  createTranslationState,
  recordTranslation,
  recordTranslationError,
  withDraft,
  type TranslationState,
} from './state.ts';

/** Actions exposed by the host for the latest translation. */
export type TranslationOverlayActions = {
  /** Copy the latest translation to the system clipboard. */
  readonly copyLatest: (text: string) => Promise<void>;
  /** Insert the latest translation into Pi's main editor. */
  readonly insertLatest: (text: string) => void;
};

/** State needed to reopen the live workspace after a terminal resize. */
export type TranslationOverlayResume = {
  readonly state: TranslationState;
  readonly messages: readonly Message[];
  readonly cursor: number;
  readonly notice: string | undefined;
};

/** Result returned when the translation overlay is dismissed or reflowed. */
export type TranslationOverlayResult =
  | { readonly action: 'closed' }
  | { readonly action: 'resize'; readonly resume: TranslationOverlayResume };

/**
 * Focusable conversational overlay with a private model message array.
 *
 * The message array is deliberately owned by this component and is never sent
 * through Pi's session actions or persisted as a session entry.
 */
export class TranslationOverlay implements Component, Focusable {
  focused = false;

  private state: TranslationState;
  private cursor = 0;
  private notice: string | undefined;
  private closed = false;
  private activeController: AbortController | undefined;
  private messages: Message[] = [];
  private readonly initialLayout: TranslationOverlayLayout;
  private resizeRequested = false;
  private resizeQueued = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly modelRegistry: ModelRegistry,
    private readonly model: TranslationModel,
    source: string,
    targetLanguage: string,
    private readonly actions: TranslationOverlayActions,
    private readonly done: (result: TranslationOverlayResult) => void,
    resume?: TranslationOverlayResume,
  ) {
    this.initialLayout = getTranslationOverlayLayout(tui.terminal.columns);
    if (resume) {
      this.state = resume.state;
      this.messages = [...resume.messages];
      this.cursor = resume.cursor;
      this.notice = resume.notice;
    } else {
      this.state = createTranslationState(source, targetLanguage);
      void this.requestTranslation();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.close();
      return;
    }

    if (matchesKey(data, Key.ctrl('y'))) {
      this.copyLatest();
      return;
    }

    if (matchesKey(data, Key.ctrl('i'))) {
      this.insertLatest();
      return;
    }

    if (this.activeController) {
      return;
    }

    if (matchesKey(data, Key.return)) {
      this.submitDraft();
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      this.deleteBeforeCursor();
      return;
    }

    if (matchesKey(data, Key.left)) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.right)) {
      this.cursor = Math.min(graphemes(this.state.draft).length, this.cursor + 1);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.home)) {
      this.cursor = 0;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.end)) {
      this.cursor = graphemes(this.state.draft).length;
      this.tui.requestRender();
      return;
    }

    const printable = parsePrintableInput(data);
    if (printable) {
      this.insertAtCursor(printable);
    }
  }

  render(width: number): string[] {
    this.queueResizeIfNeeded();
    const rows = this.tui.terminal.rows ?? 30;
    return renderTranslationOverlay(
      this.state,
      this.theme,
      width,
      Math.max(0, rows - 9),
      this.cursor,
      this.focused,
      this.notice,
      `${this.model.provider}/${this.model.id}`,
    );
  }

  invalidate(): void {}

  dispose(): void {
    this.closed = true;
    this.activeController?.abort();
    this.activeController = undefined;
    this.messages = [];
  }

  private async requestTranslation(refinement?: string): Promise<void> {
    if (this.closed || this.activeController) {
      return;
    }

    const messageCountBeforeRequest = this.messages.length;
    if (refinement === undefined || this.state.latestTranslation === undefined) {
      this.messages = appendModelMessage(
        this.messages,
        createTranslationMessage(this.state.source, this.state.targetLanguage),
      );
    }
    if (refinement !== undefined) {
      this.messages = appendModelMessage(this.messages, createRefinementMessage(refinement));
    }
    this.state = withDraft(beginTranslation(this.state), '');
    this.cursor = 0;
    this.notice = undefined;
    this.tui.requestRender();

    const controller = new AbortController();
    this.activeController = controller;

    try {
      const response = await this.modelRegistry.complete(
        this.model,
        { systemPrompt: TRANSLATOR_SYSTEM_PROMPT, messages: this.messages },
        { signal: controller.signal, cacheRetention: 'none' },
      );

      if (controller.signal.aborted) {
        return;
      }
      if (response.stopReason === 'aborted') {
        this.messages = this.messages.slice(0, messageCountBeforeRequest);
        if (!this.closed) {
          this.state = recordTranslationError(this.state, 'Translation cancelled.');
          this.tui.requestRender();
        }
        return;
      }
      if (!isUsableAssistantResponse(response)) {
        throw new Error('empty response');
      }

      const translation = extractAssistantText(response);
      this.messages = appendModelMessage(this.messages, response);
      this.state = recordTranslation(this.state, refinement, translation);
      this.tui.requestRender();
    } catch {
      if (this.closed || controller.signal.aborted) {
        return;
      }
      this.messages = this.messages.slice(0, messageCountBeforeRequest);
      this.state = recordTranslationError(
        this.state,
        'Translation failed. Check the selected model and try again.',
      );
      this.tui.requestRender();
    } finally {
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
      this.queueResizeIfNeeded();
    }
  }

  private submitDraft(): void {
    const refinement = this.state.draft.trim();
    if (!refinement || this.activeController || this.closed) {
      return;
    }
    void this.requestTranslation(refinement);
  }

  private insertAtCursor(input: string): void {
    const characters = graphemes(this.state.draft);
    const inserted = graphemes(input);
    characters.splice(this.cursor, 0, ...inserted);
    this.cursor += inserted.length;
    this.state = withDraft(this.state, characters.join(''));
    this.notice = undefined;
    this.tui.requestRender();
  }

  private deleteBeforeCursor(): void {
    if (this.cursor === 0) {
      return;
    }
    const characters = graphemes(this.state.draft);
    characters.splice(this.cursor - 1, 1);
    this.cursor -= 1;
    this.state = withDraft(this.state, characters.join(''));
    this.tui.requestRender();
  }

  private copyLatest(): void {
    const latest = this.state.latestTranslation;
    if (!latest) {
      this.notice = 'No translation to copy yet.';
      this.tui.requestRender();
      return;
    }

    void this.actions.copyLatest(latest).then(
      () => {
        if (this.closed) {
          return;
        }
        this.notice = 'Copied latest translation.';
        this.tui.requestRender();
      },
      () => {
        if (this.closed) {
          return;
        }
        this.notice = 'Could not copy translation.';
        this.tui.requestRender();
      },
    );
  }

  private insertLatest(): void {
    const latest = this.state.latestTranslation;
    if (!latest) {
      this.notice = 'No translation to insert yet.';
      this.tui.requestRender();
      return;
    }

    try {
      this.actions.insertLatest(latest);
      this.notice = 'Inserted latest translation into Pi editor.';
    } catch {
      this.notice = 'Could not insert translation.';
    }
    this.tui.requestRender();
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.activeController?.abort();
    this.activeController = undefined;
    this.done({ action: 'closed' });
  }

  private queueResizeIfNeeded(): void {
    const currentLayout = getTranslationOverlayLayout(this.tui.terminal.columns);
    const changed = translationOverlayLayoutChanged(this.initialLayout, currentLayout);
    if (!changed) {
      return;
    }

    this.resizeRequested = true;
    if (this.activeController || this.resizeQueued || this.closed) {
      return;
    }
    this.resizeQueued = true;
    queueMicrotask(() => {
      this.resizeQueued = false;
      if (!this.resizeRequested || this.activeController || this.closed) {
        return;
      }
      this.closed = true;
      this.done({
        action: 'resize',
        resume: {
          state: this.state,
          messages: [...this.messages],
          cursor: this.cursor,
          notice: this.notice,
        },
      });
    });
  }
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(text), (part) => part.segment);
}

/** Parse terminal input into printable draft text, rejecting C0/C1 controls. */
export function parsePrintableInput(data: string): string | undefined {
  const kittyCharacter = decodeKittyPrintable(data);
  if (kittyCharacter !== undefined) {
    return isPrintableText(kittyCharacter) ? kittyCharacter : undefined;
  }
  if (data.length === 0 || data.includes('\u001b') || data.includes('\r') || data.includes('\n')) {
    return undefined;
  }
  return isPrintableText(data) ? data : undefined;
}

function isPrintableText(text: string): boolean {
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 32 || (codePoint >= 127 && codePoint <= 159)) {
      return false;
    }
  }
  return true;
}
