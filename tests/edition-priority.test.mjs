import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/background/edition-priority.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const pro = { id: 'pro', name: 'Asterveil Pro', type: 'extension', enabled: true };

function fixture(initial = []) {
  const calls = [];
  const listeners = {};
  const timers = new Set();
  let extensions = initial;
  const browser = {
    runtime: { id: 'light' },
    management: {
      async getAll() {
        calls.push('query');
        return extensions;
      },
      async setEnabled(id, enabled) {
        calls.push(['setEnabled', id, enabled]);
      },
      onEnabled: { addListener: (fn) => (listeners.enabled = fn) },
      onInstalled: { addListener: (fn) => (listeners.installed = fn) },
    },
    tabs: {
      async query() {
        return [{ id: 1 }, { id: 2 }, {}];
      },
      async sendMessage(id, message) {
        calls.push(['stop', id, message]);
        if (id === 2) throw new Error('No receiving content script');
        calls.push('cleaned');
      },
    },
  };
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'wxt/browser') return { browser };
      if (name === '../shared/edition-coordination') {
        return { editionStopMessage: 'asterveil:edition-stop' };
      }
      if (name === '../site/target') return { contentMatches: ['https://jx.7fa4.cn/*'] };
      throw new Error(`Unexpected import: ${name}`);
    },
    setTimeout(fn) {
      timers.add(fn);
      return fn;
    },
    clearTimeout(fn) {
      timers.delete(fn);
    },
    console: { error: (...args) => calls.push(['error', ...args]) },
  });
  const check = exports.createEditionPriority();
  return {
    calls,
    listeners,
    timers,
    browser,
    check,
    replace: (value) => {
      extensions = value;
    },
  };
}

for (const [name, extensions] of [
  ['no Pro installed', []],
  ['Pro installed but disabled', [{ ...pro, enabled: false }]],
  ['similarly named extension', [{ ...pro, name: 'Asterveil Pro Tools' }]],
  ['same-name theme', [{ ...pro, type: 'theme' }]],
  ['own extension ID', [{ ...pro, id: 'light' }]],
]) {
  test(`ordinary edition runs with ${name}`, async () => {
    const f = fixture(extensions);
    assert.equal(await f.check(), true);
    assert.deepEqual(f.calls, ['query']);
  });
}

test('Pro already enabled: clean pages before disabling only self', async () => {
  const f = fixture([pro]);
  assert.equal(await f.check(), false);
  assert.deepEqual(f.calls, [
    'query',
    ['stop', 1, 'asterveil:edition-stop'],
    'cleaned',
    ['stop', 2, 'asterveil:edition-stop'],
    ['setEnabled', 'light', false],
  ]);
  assert.equal(f.timers.size, 0);
});

for (const event of ['enabled', 'installed']) {
  test(`Pro ${event} later wakes detection; duplicate events disable only once`, async () => {
    const f = fixture();
    assert.equal(typeof f.listeners[event], 'function');
    assert.equal(await f.check(), true);
    f.replace([pro]);
    f.listeners[event](pro);
    f.listeners[event](pro);
    assert.equal(await f.check(), false);
    assert.equal(f.calls.filter((call) => call[0] === 'setEnabled').length, 1);
  });
}

test('recheck current state when a stale enable event arrives', async () => {
  const f = fixture([{ ...pro, enabled: false }]);
  f.listeners.enabled(pro);
  assert.equal(await f.check(), true);
  assert.equal(
    f.calls.some((call) => call[0] === 'setEnabled'),
    false,
  );
});

test('management query failure does not disable self and a subsequent check recovers', async () => {
  const f = fixture();
  const original = f.browser.management.getAll;
  f.browser.management.getAll = async () => {
    throw new Error('Query failed');
  };
  await assert.rejects(f.check(), /Query failed/);
  f.browser.management.getAll = original;
  assert.equal(await f.check(), true);
  assert.equal(
    f.calls.some((call) => call[0] === 'setEnabled'),
    false,
  );
});

test('frozen page cannot prevent self-disable', async () => {
  const f = fixture([pro]);
  f.browser.tabs.sendMessage = () => new Promise(() => {});
  const result = f.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.timers.size, 1);
  for (const timer of f.timers) timer();
  assert.equal(await result, false);
  assert.deepEqual(f.calls.at(-1), ['setEnabled', 'light', false]);
  assert.equal(f.timers.size, 0);
});

test('failed tab enumeration still disables the ordinary edition', async () => {
  const f = fixture([pro]);
  f.browser.tabs.query = async () => {
    throw new Error('Tabs unavailable');
  };
  assert.equal(await f.check(), false);
  assert.deepEqual(f.calls.at(-1), ['setEnabled', 'light', false]);
});

test('policy refusal is reported and further content injection stays blocked', async () => {
  const f = fixture([pro]);
  f.browser.management.setEnabled = async () => {
    throw new Error('Blocked by browser policy');
  };
  await assert.rejects(f.check(), /Blocked by browser policy/);
  assert.equal(await f.check(), false);
  assert.equal(
    f.calls.some((call) => call[0] === 'error'),
    true,
  );
});
