import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture() {
  const { document, window } = parseHTML(
    '<html><body><div id="user-grade-colors"></div><button id="user-grade-palette-reset"></button><p id="user-grade-status" hidden></p><input type="radio" name="user-grade-palette-mode" value="default"><input type="radio" name="user-grade-palette-mode" value="custom"></body></html>',
  );
  const cache = new Map();
  function load(path) {
    path = resolve(root, path);
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    runInNewContext(
      ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports,
        document,
        Event: window.Event,
        AbortController,
        Error,
        setTimeout,
        clearTimeout,
        require(name) {
          if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
          return load(resolve(dirname(path), `${name}.ts`));
        },
      },
    );
    return exports;
  }
  const { Scope } = load('src/core/scope.ts');
  const { defaultSettings } = load('src/shared/settings.ts');
  const { createSettingsService } = load('src/background/settings-service.ts');
  const { mountUserNamePalette } = load('src/ui/settings/user-name-palette.ts');
  const scope = new Scope();
  let stored = defaultSettings();
  stored = {
    ...stored,
    userNames: { ...stored.userNames, palette: { ...stored.userNames.palette, mode: 'custom' } },
  };
  const service = createSettingsService(
    {
      read: async () => stored,
      write: async (next) => {
        stored = next;
      },
    },
    new Map(),
  );
  const pending = [];
  const control = mountUserNamePalette(
    document,
    scope,
    (command) =>
      new Promise((resolve, reject) => {
        pending.push({
          command,
          reject,
          async finish() {
            const settings = await service(command);
            control.render(settings);
            resolve(settings);
            await delay(0);
          },
        });
      }),
  );
  control.render(stored);
  return {
    document,
    scope,
    pending,
    stored: () => stored,
    picker: document.querySelector('#user-grade-g1'),
    hex: document.querySelector('#user-grade-hex-g1'),
    status: document.querySelector('#user-grade-status'),
    event: (node, type) => node.dispatchEvent(new window.Event(type)),
  };
}

test('color input automatically saves and coalesces edits without losing the latest value during a slow write', async () => {
  const f = fixture();
  try {
    f.picker.value = '#112233';
    f.event(f.picker, 'input');
    await delay(150);
    assert.equal(f.pending.length, 1);
    assert.equal(f.picker.disabled, false);
    for (const color of ['#445566', '#778899']) {
      f.picker.value = color;
      f.event(f.picker, 'input');
    }
    await f.pending[0].finish();
    assert.equal(f.pending.length, 2);
    assert.equal(f.pending[1].command.color, '#778899');
    assert.equal(
      f.picker.value,
      '#778899',
      'older acknowledgements must not overwrite the current draft',
    );
    await f.pending[1].finish();
    assert.equal(f.stored().userNames.palette.colors.g1, '#778899');
    f.picker.value = '#abcdef';
    f.event(f.picker, 'input');
    await delay(150);
    f.picker.value = '#778899';
    f.event(f.picker, 'input');
    await f.pending[2].finish();
    assert.equal(
      f.pending[3].command.color,
      '#778899',
      'reverting to the saved value still supersedes an in-flight edit',
    );
    await f.pending[3].finish();
    assert.equal(f.stored().userNames.palette.colors.g1, '#778899');
  } finally {
    f.scope.dispose();
  }
});

test('complete hex values auto-save, partial input survives replies, and switching modes follows queued color edits', async () => {
  const f = fixture();
  try {
    Object.defineProperty(f.document, 'activeElement', { value: f.hex, configurable: true });
    f.hex.value = '#445566';
    f.event(f.hex, 'input');
    await delay(150);
    f.hex.value = '#12';
    f.event(f.hex, 'input');
    f.event(f.hex, 'change');
    await f.pending[0].finish();
    assert.equal(f.hex.value, '#12');
    assert.equal(
      f.hex.getAttribute('aria-invalid'),
      'true',
      'an earlier save must not dismiss a new invalid value',
    );
    assert.equal(f.pending.length, 1);
    assert.equal(f.stored().userNames.palette.colors.g1, '#445566');
    f.event(f.hex, 'change');
    assert.equal(f.hex.getAttribute('aria-invalid'), 'true');
    f.hex.value = '#aabbcc';
    f.event(f.hex, 'input');
    const mode = f.document.querySelector('[value="default"]');
    f.event(mode, 'change');
    assert.equal(f.pending[1].command.type, 'settings.user-names.palette.color');
    await f.pending[1].finish();
    assert.equal(f.pending[2].command.type, 'settings.user-names.palette.mode');
    await f.pending[2].finish();
    assert.equal(f.stored().userNames.palette.mode, 'default');
    assert.equal(f.stored().userNames.palette.colors.g1, '#aabbcc');
  } finally {
    f.scope.dispose();
  }
});

test('failed auto-saves remain retryable and disposal cancels unsubmitted edits', async () => {
  const f = fixture();
  try {
    f.picker.value = '#112233';
    f.event(f.picker, 'input');
    await delay(150);
    f.pending[0].reject(new Error('存储空间不足'));
    await delay(0);
    assert.equal(f.status.textContent, '存储空间不足');
    assert.equal(f.picker.disabled, false);
    f.event(f.hex, 'change');
    assert.equal(f.pending[1].command.color, '#112233');
    await f.pending[1].finish();
    assert.equal(f.stored().userNames.palette.colors.g1, '#112233');
    assert.equal(f.status.hidden, true);
    f.picker.value = '#445566';
    f.event(f.picker, 'input');
    f.scope.dispose();
    await delay(150);
    assert.equal(f.pending.length, 2);
  } finally {
    f.scope.dispose();
  }
});
