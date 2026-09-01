import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getAgentDir } from '@earendil-works/pi-coding-agent';

import { DEFAULT_TARGET_LANGUAGE, parseTargetLanguage } from './model.ts';

/** A stable reference to a translation model in Pi's registry. */
export type TranslationModelReference = {
  readonly provider: string;
  readonly id: string;
};

/** Persisted user preferences for the translation overlay. */
export type TranslationOverlayConfig = {
  readonly model: TranslationModelReference | undefined;
  readonly targetLanguage: string;
};

/** Result of loading translation preferences. */
export type LoadTranslationOverlayConfigResult =
  | { readonly ok: true; readonly config: TranslationOverlayConfig }
  | { readonly ok: false; readonly error: string };

/** Result of persisting translation preferences. */
export type SaveTranslationOverlayConfigResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const CONFIG_PATH = join(getAgentDir(), 'translation.json');
const DEFAULT_CONFIG: TranslationOverlayConfig = {
  model: undefined,
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
};

/** Load configured translation preferences with defaults for omitted fields. */
export async function loadTranslationOverlayConfig(): Promise<LoadTranslationOverlayConfigResult> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, 'utf8');
  } catch (cause: unknown) {
    if (isMissingFile(cause)) {
      return { ok: true, config: DEFAULT_CONFIG };
    }
    return { ok: false, error: 'Could not read translation overlay configuration.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Translation overlay configuration is invalid JSON.' };
  }

  return parseTranslationOverlayConfig(parsed);
}

/** Parse an unknown JSON value into translation preferences. */
export function parseTranslationOverlayConfig(input: unknown): LoadTranslationOverlayConfigResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Translation overlay configuration must be an object.' };
  }

  const provider = Reflect.get(input, 'provider');
  const id = Reflect.get(input, 'id');
  let model: TranslationModelReference | undefined;
  if (provider !== undefined || id !== undefined) {
    if (
      typeof provider !== 'string' ||
      provider.length === 0 ||
      typeof id !== 'string' ||
      id.length === 0
    ) {
      return {
        ok: false,
        error: 'Translation overlay configuration requires both provider and id strings.',
      };
    }
    model = { provider, id };
  }

  const targetInput = Reflect.get(input, 'targetLanguage');
  if (targetInput !== undefined && typeof targetInput !== 'string') {
    return { ok: false, error: 'Translation overlay targetLanguage must be a string.' };
  }
  const target = parseTargetLanguage(targetInput ?? '');
  if (!target.ok) {
    return target;
  }

  return { ok: true, config: { model, targetLanguage: target.value } };
}

/** Persist all translation preferences atomically. */
export async function saveTranslationOverlayConfig(
  config: TranslationOverlayConfig,
): Promise<SaveTranslationOverlayConfigResult> {
  const temporaryPath = `${CONFIG_PATH}.tmp-${process.pid}`;
  const stored = {
    ...(config.model ? { provider: config.model.provider, id: config.model.id } : {}),
    targetLanguage: config.targetLanguage,
  };

  try {
    await writeFile(temporaryPath, `${JSON.stringify(stored, undefined, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, CONFIG_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save translation overlay configuration.' };
  }
}

function isMissingFile(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT';
}
