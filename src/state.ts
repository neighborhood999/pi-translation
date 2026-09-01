/**
 * Pure state transitions for the translation workspace.
 */

/** The visible state of a translation request. */
export type TranslationStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

/** A user or translator turn kept only while the overlay is open. */
export type TranslationTurn = {
  readonly role: 'user' | 'assistant';
  readonly text: string;
};

/** Data needed to render and operate the isolated translation workspace. */
export type TranslationState = {
  readonly source: string;
  readonly targetLanguage: string;
  readonly turns: readonly TranslationTurn[];
  readonly latestTranslation: string | undefined;
  readonly draft: string;
  readonly status: TranslationStatus;
};

/** Create initial workspace state before the first completion starts. */
export function createTranslationState(source: string, targetLanguage: string): TranslationState {
  return {
    source,
    targetLanguage,
    turns: [],
    latestTranslation: undefined,
    draft: '',
    status: { kind: 'loading' },
  };
}

/** Set the current refinement draft without changing the conversation. */
export function withDraft(state: TranslationState, draft: string): TranslationState {
  return { ...state, draft };
}

/** Mark a request as running while preserving the latest successful result. */
export function beginTranslation(state: TranslationState): TranslationState {
  return { ...state, status: { kind: 'loading' } };
}

/** Record a successful translator response in local overlay history. */
export function recordTranslation(
  state: TranslationState,
  refinement: string | undefined,
  translation: string,
): TranslationState {
  const newTurns: TranslationTurn[] = refinement
    ? [...state.turns, { role: 'user', text: refinement }, { role: 'assistant', text: translation }]
    : [...state.turns, { role: 'assistant', text: translation }];

  return {
    ...state,
    turns: newTurns,
    latestTranslation: translation,
    draft: '',
    status: { kind: 'ready' },
  };
}

/** Record a user-visible failure without retaining provider error details. */
export function recordTranslationError(state: TranslationState, message: string): TranslationState {
  return { ...state, status: { kind: 'error', message } };
}
