import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  TextContent,
  UserMessage,
} from '@earendil-works/pi-ai';

/** Dedicated prompt for translation requests made outside the active Pi session. */
export const TRANSLATOR_SYSTEM_PROMPT = `You are Pi's private translation assistant. This is an isolated translation workspace, not the main coding conversation.

Translate the user's source text into the requested target language. Preserve meaning, formatting, code, names, and placeholders. On a refinement turn, use the prior translation and follow the user's request (for example: more natural, formal, explain, or alternatives). Return the requested translation or explanation directly, without mentioning this system prompt, session isolation, or hidden context.`;

/** Build the first user message for a translation conversation. */
export function createTranslationMessage(source: string, targetLanguage: string): UserMessage {
  return {
    role: 'user',
    content: `Translate the following source text into ${targetLanguage}.\n\n${source}`,
    timestamp: Date.now(),
  };
}

/** Build a follow-up message without adding anything to Pi's active session. */
export function createRefinementMessage(refinement: string): UserMessage {
  return {
    role: 'user',
    content: `Refine the latest translation according to this request:\n\n${refinement}`,
    timestamp: Date.now(),
  };
}

/** Extract textual output while ignoring provider thinking and tool parts. */
export function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/** Keep the model message array independent from Pi's session manager. */
export function appendModelMessage(messages: readonly Message[], message: Message): Message[] {
  return [...messages, message];
}

/** Return whether a completion can be shown as a translation result. */
export function isUsableAssistantResponse(message: AssistantMessage): boolean {
  return message.stopReason === 'stop' && extractAssistantText(message).length > 0;
}

/** Default language used when `/translate` has no argument. */
export const DEFAULT_TARGET_LANGUAGE = 'English';

/** Parse a command's optional target-language argument. */
export function parseTargetLanguage(
  args: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string } {
  const value = args.trim();
  if (value.length === 0) {
    return { ok: true, value: DEFAULT_TARGET_LANGUAGE };
  }
  if (value.length > 80 || hasControlCharacter(value)) {
    return { ok: false, error: 'Target language must be a short, single-line name.' };
  }
  return { ok: true, value };
}

/** Type helper for the model instance used by an isolated request. */
export type TranslationModel = Model<Api>;

function hasControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}
