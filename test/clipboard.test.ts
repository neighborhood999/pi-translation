import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExecOptions, ExecResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { readClipboardText } from '../src/clipboard.ts';

type ClipboardExec = Pick<ExtensionAPI, 'exec'>;
type ExecCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
};

type FakeExec = {
  readonly pi: ClipboardExec;
  readonly calls: ExecCall[];
};

type ClipboardTestRuntimeFacts = {
  readonly platform: NodeJS.Platform;
  readonly hasWaylandDisplay: boolean;
  readonly hasX11Display: boolean;
};

function runtime(
  platform: ClipboardTestRuntimeFacts['platform'],
  hasWaylandDisplay = false,
  hasX11Display = false,
): ClipboardTestRuntimeFacts {
  return { platform, hasWaylandDisplay, hasX11Display };
}

function fakeExec(results: ReadonlyArray<ExecResult>): FakeExec {
  const calls: ExecCall[] = [];
  let index = 0;
  return {
    calls,
    pi: {
      exec: async (command, args, options) => {
        calls.push({ command, args, options });
        const result = results[index];
        index += 1;
        if (result === undefined) {
          throw new Error('unexpected clipboard command');
        }
        return result;
      },
    },
  };
}

function success(stdout: string): ExecResult {
  return { stdout, stderr: '', code: 0, killed: false };
}

function failure(code = 1): ExecResult {
  return { stdout: '', stderr: 'clipboard unavailable', code, killed: false };
}

function callAt(calls: ReadonlyArray<ExecCall>, index: number): ExecCall {
  const call = calls[index];
  assert.ok(call);
  return call;
}

function optionsOf(call: ExecCall): ExecOptions {
  assert.ok(call.options);
  return call.options;
}

test('selects pbpaste on macOS', async () => {
  const fake = fakeExec([success('hello')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('darwin'));

  assert.deepEqual(result, { ok: true, text: 'hello' });
  assert.deepEqual(fake.calls, [
    { command: 'pbpaste', args: [], options: { cwd: '/tmp', timeout: 5_000 } },
  ]);
});

test('uses PowerShell with the exact Windows clipboard arguments', async () => {
  const fake = fakeExec([success('hello')]);

  const result = await readClipboardText(fake.pi, 'C:\\work', runtime('win32'));

  assert.deepEqual(result, { ok: true, text: 'hello' });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], {
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw -Format Text',
    ],
    options: { cwd: 'C:\\work', timeout: 5_000 },
  });
});

test('selects wl-paste when Wayland is available', async () => {
  const fake = fakeExec([success('wayland text')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', true));

  assert.deepEqual(result, { ok: true, text: 'wayland text' });
  assert.deepEqual(callAt(fake.calls, 0), {
    command: 'wl-paste',
    args: ['--no-newline', '--type', 'text'],
    options: { cwd: '/tmp', timeout: 5_000 },
  });
});

test('selects xclip when X11 is available', async () => {
  const fake = fakeExec([success('x11 text')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', false, true));

  assert.deepEqual(result, { ok: true, text: 'x11 text' });
  assert.deepEqual(callAt(fake.calls, 0), {
    command: 'xclip',
    args: ['-selection', 'clipboard', '-out'],
    options: { cwd: '/tmp', timeout: 5_000 },
  });
});

test('falls back from Wayland to X11 when Wayland fails', async () => {
  const fake = fakeExec([failure(), success('x11 fallback')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', true, true));

  assert.deepEqual(result, { ok: true, text: 'x11 fallback' });
  assert.deepEqual(
    fake.calls.map(({ command, args }) => ({ command, args })),
    [
      { command: 'wl-paste', args: ['--no-newline', '--type', 'text'] },
      { command: 'xclip', args: ['-selection', 'clipboard', '-out'] },
    ],
  );
});

test('falls back from xclip to xsel when xclip fails', async () => {
  const fake = fakeExec([failure(), success('xsel fallback')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', false, true));

  assert.deepEqual(result, { ok: true, text: 'xsel fallback' });
  assert.deepEqual(callAt(fake.calls, 1), {
    command: 'xsel',
    args: ['--clipboard', '--output'],
    options: { cwd: '/tmp', timeout: 5_000 },
  });
});

test('stops on successful empty xclip output instead of trying xsel', async () => {
  const fake = fakeExec([success('')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', false, true));

  assert.deepEqual(result, { ok: false, reason: 'empty' });
  assert.deepEqual(
    fake.calls.map(({ command }) => command),
    ['xclip'],
  );
});

test('falls back to X11 when Wayland execution is rejected', async () => {
  const calls: ExecCall[] = [];
  let invocation = 0;
  const pi: ClipboardExec = {
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      invocation += 1;
      if (invocation === 1) {
        throw new Error('spawn failed');
      }
      return success('recovered');
    },
  };

  const result = await readClipboardText(pi, '/tmp', runtime('linux', true, true));

  assert.deepEqual(result, { ok: true, text: 'recovered' });
  assert.deepEqual(
    calls.map(({ command }) => command),
    ['wl-paste', 'xclip'],
  );
});

test('falls back to X11 when Wayland is killed', async () => {
  const fake = fakeExec([
    { stdout: 'partial', stderr: '', code: 0, killed: true },
    success('recovered'),
  ]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', true, true));

  assert.deepEqual(result, { ok: true, text: 'recovered' });
  assert.deepEqual(
    fake.calls.map(({ command }) => command),
    ['wl-paste', 'xclip'],
  );
});

test('tries the next adapter after a nonzero exit', async () => {
  const fake = fakeExec([failure(2), success('recovered')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', false, true));

  assert.deepEqual(result, { ok: true, text: 'recovered' });
  assert.equal(fake.calls.length, 2);
});

test('returns unavailable when every eligible adapter fails', async () => {
  const fake = fakeExec([failure(), failure(), failure()]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux', true, true));

  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
  assert.deepEqual(
    fake.calls.map(({ command }) => command),
    ['wl-paste', 'xclip', 'xsel'],
  );
});

test('returns unavailable when no clipboard adapter is eligible', async () => {
  const fake = fakeExec([]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('linux'));

  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
  assert.equal(fake.calls.length, 0);
});

test('does not invoke a command on an unsupported non-Linux platform', async () => {
  const fake = fakeExec([]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('freebsd'));

  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
  assert.equal(fake.calls.length, 0);
});

test('normalizes CRLF and CR and removes trailing line endings', async () => {
  const fake = fakeExec([success('first\r\nsecond\rthird\n\n')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('darwin'));

  assert.deepEqual(result, { ok: true, text: 'first\nsecond\nthird' });
});

test('preserves indentation, trailing spaces, tabs, Unicode, and internal blank lines', async () => {
  const text = '  leading\n\ttrailing spaces  \n\nUnicode: 你好 👋\ninternal\n\n  final\t ';
  const fake = fakeExec([success(text)]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('darwin'));

  assert.deepEqual(result, { ok: true, text });
});

test('classifies whitespace-only output as empty without trimming returned text', async () => {
  const fake = fakeExec([success('  \t\r\n')]);

  const result = await readClipboardText(fake.pi, '/tmp', runtime('darwin'));

  assert.deepEqual(result, { ok: false, reason: 'empty' });
});

test('uses the requested working directory and timeout for every command', async () => {
  const fake = fakeExec([failure(), success('xsel')]);

  await readClipboardText(fake.pi, '/work', runtime('linux', false, true));

  assert.deepEqual(optionsOf(callAt(fake.calls, 0)), { cwd: '/work', timeout: 5_000 });
  assert.deepEqual(optionsOf(callAt(fake.calls, 1)), { cwd: '/work', timeout: 5_000 });
});
