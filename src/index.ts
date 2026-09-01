import type { Api, Model } from '@earendil-works/pi-ai';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { copyToClipboard } from '@earendil-works/pi-coding-agent';
import { Key, type TUI } from '@earendil-works/pi-tui';

import { readClipboardText } from './clipboard.ts';
import {
  loadTranslationOverlayConfig,
  saveTranslationOverlayConfig,
  type TranslationModelReference,
} from './config.ts';
import { parseTargetLanguage, type TranslationModel } from './model.ts';
import {
  TranslationOverlay,
  type TranslationOverlayResult,
  type TranslationOverlayResume,
} from './overlay.ts';
import { getTranslationOverlayLayout } from './render.ts';

const CURRENT_MODEL_OPTION = 'Use current Pi model (default)';

type ResolveTranslationModelResult =
  | { readonly ok: true; readonly model: TranslationModel }
  | { readonly ok: false; readonly error: string };

/** Register the clipboard-first, isolated `/translate` workspace. */
export default function translationOverlayExtension(pi: ExtensionAPI): void {
  const openTranslation = async (ctx: ExtensionContext, args: string): Promise<void> => {
    if (ctx.mode !== 'tui') {
      ctx.ui.notify('translate requires TUI mode', 'error');
      return;
    }

    const configResult = await loadTranslationOverlayConfig();
    if (!configResult.ok) {
      ctx.ui.notify(configResult.error, 'error');
      return;
    }
    const config = configResult.config;

    const targetResult = parseTargetLanguage(args.trim().length > 0 ? args : config.targetLanguage);
    if (!targetResult.ok) {
      ctx.ui.notify(targetResult.error, 'error');
      return;
    }

    const resolvedModel = resolveTranslationModel(ctx, config.model);
    if (!resolvedModel.ok) {
      ctx.ui.notify(resolvedModel.error, 'error');
      return;
    }
    const model = resolvedModel.model;

    const clipboard = await readClipboardText(pi, ctx.cwd);
    if (!clipboard.ok) {
      ctx.ui.notify(
        clipboard.reason === 'empty'
          ? 'Clipboard is empty. Copy terminal text, then run /translate.'
          : 'Clipboard is unavailable. Copy terminal text and verify macOS pbpaste is available.',
        'error',
      );
      return;
    }

    let resume: TranslationOverlayResume | undefined;
    while (true) {
      let activeTui: TUI | undefined;
      // Pi 0.84.4 resolves overlay options when the overlay is created. The
      // component detects later layout changes and returns a resume snapshot.
      const result = await ctx.ui.custom<TranslationOverlayResult>(
        (tui, theme, _keybindings, done) => {
          activeTui = tui;
          return new TranslationOverlay(
            tui,
            theme,
            ctx.modelRegistry,
            model,
            clipboard.text,
            targetResult.value,
            {
              copyLatest: (text) => copyToClipboard(text),
              insertLatest: (text) => ctx.ui.pasteToEditor(text),
            },
            done,
            resume,
          );
        },
        {
          overlay: true,
          overlayOptions: () => {
            const layout = getTranslationOverlayLayout(activeTui?.terminal.columns ?? 80);
            return {
              anchor: layout.anchor,
              width: layout.width,
              maxHeight: '100%',
              margin: layout.mode === 'side' ? { right: 1 } : 0,
            };
          },
        },
      );

      if (result.action === 'closed') {
        return;
      }
      resume = result.resume;
    }
  };

  pi.registerCommand('translate', {
    description: 'Translate copied terminal text in an isolated overlay',
    handler: async (args: string, ctx: ExtensionCommandContext) => openTranslation(ctx, args),
  });

  pi.registerCommand('translate-model', {
    description: 'Choose the model used only by the translation overlay',
    handler: async (_args: string, ctx: ExtensionCommandContext) => configureTranslationModel(ctx),
  });

  pi.registerCommand('translate-language', {
    description: 'Set the default target language for /translate',
    handler: async (args: string, ctx: ExtensionCommandContext) =>
      configureTargetLanguage(ctx, args),
  });

  pi.registerShortcut(Key.ctrlAlt('t'), {
    description: 'Open translation overlay from clipboard',
    handler: async (ctx: ExtensionContext) => openTranslation(ctx, ''),
  });
}

function resolveTranslationModel(
  ctx: ExtensionContext,
  configuredModel: TranslationModelReference | undefined,
): ResolveTranslationModelResult {
  if (configuredModel === undefined) {
    return ctx.model
      ? { ok: true, model: ctx.model }
      : { ok: false, error: 'No model selected. Choose one in Pi or run /translate-model.' };
  }

  const model = ctx.modelRegistry.find(configuredModel.provider, configuredModel.id);
  if (!model) {
    return {
      ok: false,
      error: `Configured translation model ${formatModelReference(configuredModel)} is unavailable. Run /translate-model.`,
    };
  }
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
    return {
      ok: false,
      error: `Configured translation model ${formatModelReference(configuredModel)} has no authentication. Run /translate-model.`,
    };
  }
  return { ok: true, model };
}

async function configureTranslationModel(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify('translate-model requires an interactive UI', 'error');
    return;
  }

  const scoped = ctx.scopedModels.map((entry) => entry.model);
  const available = (scoped.length > 0 ? scoped : ctx.modelRegistry.getAvailable())
    .filter((model) => ctx.modelRegistry.hasConfiguredAuth(model))
    .sort(compareModelCost);
  const labels = available.map(formatModelOption);
  const selected = await ctx.ui.select('Translation model (cheapest listed first)', [
    CURRENT_MODEL_OPTION,
    ...labels,
  ]);
  if (selected === undefined) {
    return;
  }

  const model = selected === CURRENT_MODEL_OPTION ? undefined : available[labels.indexOf(selected)];
  if (selected !== CURRENT_MODEL_OPTION && model === undefined) {
    ctx.ui.notify('Selected translation model is no longer available.', 'error');
    return;
  }

  const config = await loadTranslationOverlayConfig();
  if (!config.ok) {
    ctx.ui.notify(config.error, 'error');
    return;
  }
  const reference = model ? { provider: model.provider, id: model.id } : undefined;
  const saved = await saveTranslationOverlayConfig({ ...config.config, model: reference });
  if (!saved.ok) {
    ctx.ui.notify(saved.error, 'error');
    return;
  }

  ctx.ui.notify(
    model
      ? `Translation model: ${model.provider}/${model.id}`
      : 'Translation model follows the current Pi model.',
    'info',
  );
}

async function configureTargetLanguage(ctx: ExtensionCommandContext, args: string): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify('translate-language requires an interactive UI', 'error');
    return;
  }

  const config = await loadTranslationOverlayConfig();
  if (!config.ok) {
    ctx.ui.notify(config.error, 'error');
    return;
  }

  const entered =
    args.trim().length > 0
      ? args
      : await ctx.ui.input('Default translation target', config.config.targetLanguage);
  if (entered === undefined) {
    return;
  }

  const target = parseTargetLanguage(entered);
  if (!target.ok) {
    ctx.ui.notify(target.error, 'error');
    return;
  }

  const saved = await saveTranslationOverlayConfig({
    ...config.config,
    targetLanguage: target.value,
  });
  if (!saved.ok) {
    ctx.ui.notify(saved.error, 'error');
    return;
  }
  ctx.ui.notify(`Default translation target: ${target.value}`, 'info');
}

function compareModelCost(left: Model<Api>, right: Model<Api>): number {
  const leftCost = left.cost.input + left.cost.output;
  const rightCost = right.cost.input + right.cost.output;
  return (
    leftCost - rightCost ||
    `${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`)
  );
}

function formatModelOption(model: Model<Api>): string {
  const input = formatCost(model.cost.input);
  const output = formatCost(model.cost.output);
  return `${model.provider}/${model.id} · $${input} in / $${output} out per 1M`;
}

function formatCost(cost: number): string {
  return cost.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatModelReference(model: TranslationModelReference): string {
  return `${model.provider}/${model.id}`;
}
