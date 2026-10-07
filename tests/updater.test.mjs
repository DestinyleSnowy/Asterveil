import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../src/background/updater-service.ts', import.meta.url),
  'utf8',
);
const transpile = (text) =>
  ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const shared = {};
runInNewContext(
  transpile(readFileSync(new URL('../src/shared/updater.ts', import.meta.url), 'utf8')),
  {
    exports: shared,
    require: () => ({ isRecord: (v) => v !== null && typeof v === 'object' && !Array.isArray(v) }),
  },
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('update status uses plain language without presenting a failed check as current', () => {
  const text = (status, message = '') =>
    shared.updateStatusText({ ...shared.initialUpdateState, status, message });
  assert.equal(text('current'), '当前已是最新版本');
  assert.equal(text('error', '发布缺少有效的更新附件'), '暂时无法获取更新');
  assert.equal(text('error', 'GitHub 请求超时，请稍后重试'), '连接失败，请稍后重试');
  assert.equal(text('error', '未知内部路径和错误'), '更新失败，请重试');
  assert.equal(text('unavailable'), '请先安装更新器');
  assert.equal(text('idle'), '');
});
async function settle() {
  for (let i = 0; i < 12; i++) await tick();
}

function fixture(options = {}) {
  const calls = [];
  const listeners = {};
  const alarms = new Map();
  const timers = new Set();
  let saved = { ...shared.initialUpdateState, ...options.state };
  let blocked = options.busy ?? false;
  const browser = {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getContexts: async () => (options.popup ? [{}] : []),
      reload: () => calls.push('reload'),
      onStartup: {
        addListener: (fn) => {
          listeners.startup = fn;
        },
      },
      onInstalled: {
        addListener: (fn) => {
          listeners.installed = fn;
        },
      },
      connectNative() {
        if (options.missing) throw new Error('not installed');
        let receive;
        return {
          onDisconnect: { addListener() {} },
          onMessage: {
            addListener: (fn) => {
              receive = fn;
            },
          },
          disconnect() {},
          postMessage(request) {
            calls.push(request.command);
            assert.equal(request.protocol, 1);
            assert.equal(request.edition, options.light ? 'light' : 'full');
            Promise.resolve().then(async () => {
              try {
                const result = await (options.native?.(request.command) ??
                  {
                    status: { state: 'ready', version: '0.1.0' },
                    prepare: { state: 'prepared', version: '0.2.0' },
                    apply: { state: 'installed', version: '0.2.0' },
                    confirm: { state: 'confirmed' },
                  }[request.command]);
                receive({ ok: true, result });
              } catch (error) {
                receive({ ok: false, error: error.message });
              }
            });
          },
        };
      },
    },
    storage: {
      local: {
        get: async () => ({ [shared.updateStorageKey]: saved }),
        set: async (value) => {
          saved = value[shared.updateStorageKey];
        },
      },
    },
    alarms: {
      create: async (name, data) => {
        alarms.set(name, data);
      },
      get: async (name) => alarms.get(name),
      clear: async (name) => alarms.delete(name),
      onAlarm: {
        addListener: (fn) => {
          listeners.alarm = fn;
        },
      },
    },
    tabs: {
      query: async () => options.tabs ?? [],
      sendMessage: async (id, message) => {
        calls.push(`${message.type}:${id}`);
        return message.type === 'unlock' || !blocked;
      },
    },
  };
  const exports = {};
  runInNewContext(transpile(source), {
    exports,
    require(name) {
      if (name === 'wxt/browser') return { browser };
      if (name === '../shared/edition') return { pdfEnabled: !options.light };
      if (name === '../shared/settings')
        return { isRecord: (v) => v !== null && typeof v === 'object' && !Array.isArray(v) };
      if (name === '../shared/updater') return shared;
      if (name === '../site/target') return { contentMatches: ['https://jx.7fa4.cn/*'] };
      throw new Error(`Unexpected import ${name}`);
    },
    setTimeout: (fn) => {
      timers.add(fn);
      return fn;
    },
    clearTimeout: (fn) => timers.delete(fn),
    Date,
  });
  const handle = exports.createUpdaterService(() => options.submitting === true);
  return {
    calls,
    alarms,
    listeners,
    timers,
    handle,
    state: () => saved,
    unblock: () => {
      blocked = false;
    },
  };
}

test('updater is off by default and does not contact native host', async () => {
  const f = fixture();
  await settle();
  assert.deepEqual(f.calls, []);
  assert.equal(f.state().enabled, false);
});
test('manual update verifies first, locks pages, installs, unlocks and reloads', async () => {
  const f = fixture({ tabs: [{ id: 1 }] });
  await settle();
  await f.handle({ type: 'check' });
  await settle();
  assert.deepEqual(f.calls, ['prepare', 'lock:1', 'apply', 'unlock:1', 'reload']);
  assert.equal(f.state().version, '0.2.0');
});
test('busy page defers installation and the retry proceeds once idle', async () => {
  const f = fixture({ tabs: [{ id: 1 }], busy: true });
  await settle();
  await f.handle({ type: 'check' });
  await settle();
  assert.equal(f.state().status, 'waiting');
  assert.ok(!f.calls.includes('apply'));
  f.unblock();
  f.listeners.alarm({ name: 'asterveil:update-apply' });
  await settle();
  assert.ok(f.calls.includes('apply'));
  assert.ok(f.calls.includes('reload'));
});
for (const reason of ['popup', 'submitting'])
  test(`open ${reason} prevents update`, async () => {
    const f = fixture({ [reason]: true });
    await settle();
    await f.handle({ type: 'check' });
    await settle();
    assert.equal(f.state().status, 'waiting');
    assert.ok(!f.calls.includes('apply'));
  });
test('network or signature failure never installs or reloads', async () => {
  const f = fixture({
    native: () => {
      throw new Error('更新签名验证失败');
    },
  });
  await settle();
  await f.handle({ type: 'check' });
  await settle();
  assert.deepEqual(f.calls, ['prepare']);
  assert.equal(f.state().status, 'error');
});
test('missing updater is actionable and leaves extension usable', async () => {
  const f = fixture({ missing: true });
  await settle();
  await f.handle({ type: 'check' });
  await settle();
  assert.equal(f.state().status, 'unavailable');
  assert.ok(!f.calls.includes('reload'));
});
test('new worker acknowledges a pending installation even with auto updates off', async () => {
  const f = fixture({
    state: { status: 'installing' },
    native: (command) =>
      command === 'status'
        ? { state: 'ready', version: '0.1.0', transaction: { phase: 'pending' } }
        : { state: 'confirmed' },
  });
  await settle();
  assert.deepEqual(f.calls, ['status', 'confirm']);
});
test('disabling during download prevents installation', async () => {
  let finish;
  const f = fixture({
    native: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await settle();
  await f.handle({ type: 'enabled', enabled: true });
  await settle();
  await f.handle({ type: 'enabled', enabled: false });
  finish({ state: 'prepared', version: '0.2.0' });
  await settle();
  assert.deepEqual(f.calls, ['prepare']);
  assert.equal(f.state().status, 'idle');
});
test('install failure unlocks pages and does not reload', async () => {
  const f = fixture({
    tabs: [{ id: 1 }],
    native: (command) => {
      if (command === 'apply') throw new Error('目录被占用');
      return { state: 'prepared', version: '0.2.0' };
    },
  });
  await settle();
  await f.handle({ type: 'check' });
  await settle();
  assert.deepEqual(f.calls, ['prepare', 'lock:1', 'apply', 'unlock:1']);
  assert.equal(f.state().status, 'error');
});
test('ordinary edition asks for light packages', async () => {
  const f = fixture({ light: true });
  await settle();
  await f.handle({ type: 'check' });
  await settle();
  assert.ok(f.calls.includes('reload'));
});

test('manual waiting update resumes when its alarm starts a sleeping worker', async () => {
  const f = fixture({ state: { enabled: false, status: 'waiting', version: '0.2.0' } });
  f.listeners.alarm({ name: 'asterveil:update-apply' });
  await settle();
  assert.ok(f.calls.includes('apply'));
  assert.ok(f.calls.includes('reload'));
});

test('browser startup checks even if the six-hour interval has not elapsed', async () => {
  const f = fixture({ state: { enabled: true, checkedAt: Date.now() - 1000 } });
  f.listeners.startup();
  await settle();
  assert.ok(f.calls.includes('prepare'));
});
