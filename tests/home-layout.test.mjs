import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
function loader(globals = {}) {
  const cache = new Map();
  function load(path) {
    path = resolve(root, path);
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const source = readFileSync(path, 'utf8');
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports,
        console,
        AbortController,
        URL,
        require(name) {
          if (name.endsWith('?inline')) return { default: '' };
          if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
          return name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : require(name);
        },
        ...globals,
      },
    );
    return exports;
  }
  return load;
}
const load = loader();
const model = load('src/shared/home-layout.ts');
const { defaultSettings, decodeSettings } = load('src/shared/settings.ts');
const { isSettingsRequest } = load('src/shared/protocol.ts');
const { createSettingsService } = load('src/background/settings-service.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('old settings gain a complete default layout without changing existing module choices', () => {
  const old = plain(defaultSettings());
  delete old.homeLayout;
  delete old.modules['home-layout'];
  old.modules.homework = false;
  const decoded = decodeSettings(old);
  assert.equal(decoded.homeLayout.length, 12);
  assert.equal(decoded.modules['home-layout'], true);
  assert.equal(decoded.modules.homework, false);
  const partial = model.decodeHomeLayout([{ id: 'timer', column: 'main', visible: false }]);
  assert.equal(partial.length, 12);
  assert.deepEqual(plain(partial[0]), { id: 'timer', column: 'main', visible: false });
});

test('reject malformed layouts and untrusted commands', () => {
  for (const bad of [
    null,
    {},
    [{ id: 'fake', column: 'main', visible: true }],
    [{ id: 'today', column: 'other', visible: true }],
    [{ id: 'today', column: 'main', visible: 1 }],
    [model.defaultHomeLayout()[0], model.defaultHomeLayout()[0]],
  ]) {
    assert.throws(() => model.decodeHomeLayout(bad));
  }
  for (const command of [
    { type: 'settings.home.visible', id: 'today', visible: 'false' },
    { type: 'settings.home.move', id: 'today', column: 'other', before: null },
    { type: 'settings.home.move', id: 'today', column: 'main', before: 'unknown' },
  ])
    assert.equal(isSettingsRequest({ channel: 'asterveil', ...command }), false);
});

test('serialized hide and move commands preserve one another and unrelated settings', async () => {
  let stored = defaultSettings();
  const initial = stored;
  const service = createSettingsService({
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
  });
  await Promise.all([
    service({ type: 'settings.home.visible', id: 'timer', visible: false }),
    service({ type: 'settings.home.move', id: 'timer', column: 'main', before: 'today' }),
    service({ type: 'settings.accent', color: '#cf5683' }),
  ]);
  assert.deepEqual(plain(stored.homeLayout[0]), { id: 'timer', column: 'main', visible: false });
  assert.equal(stored.revision, 3);
  assert.equal(stored.accentColor, '#cf5683');
  await service({ type: 'settings.home.reset' });
  assert.deepEqual(plain(stored.homeLayout), plain(initial.homeLayout));
  assert.equal(stored.accentColor, '#cf5683');
});

function fixture() {
  const pair = ({ title, id }) =>
    `<h4 class="ui top attached block header"><i></i>${title}</h4><div class="ui bottom attached segment" id="block-${id}"><button>刷新</button></div>`;
  const { document, window } = parseHTML(
    `<html><head></head><body><div class="ui main container"><div class="padding"><div class="ui three column grid"><div class="ten wide column">${model.homeSections
      .filter((s) => s.column === 'main')
      .map(pair)
      .join('')}</div><div class="six wide column">${model.homeSections
      .filter((s) => s.column === 'side')
      .map(pair)
      .join(
        '',
      )}<h4 class="ui top attached block header">未知板块</h4><div class="ui bottom attached segment" id="unknown">保留</div></div></div></div></body></html>`,
  );
  const frames = new Map();
  let sequence = 0;
  const local = loader({
    document,
    HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: (fn) => {
      frames.set(++sequence, fn);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const { Scope } = local('src/core/scope.ts');
  const scope = new Scope();
  const adapter = local('src/site/home-layout.ts').createHomeLayout(scope);
  const settings = defaultSettings();
  const main = document.querySelector('.ten.column');
  const side = document.querySelector('.six.column');
  const initial = document.querySelector('.padding').innerHTML;
  const update = (homeLayout) =>
    adapter.update(new URL('https://jx.7fa4.cn:8888/'), { ...settings, homeLayout });
  async function flush() {
    await Promise.resolve();
    for (const [id, fn] of frames) {
      frames.delete(id);
      fn();
    }
    await Promise.resolve();
  }
  return { document, window, scope, adapter, settings, main, side, initial, update, flush };
}

test('moves intact header/body pairs, retains listeners and restores exact original markup', () => {
  const f = fixture();
  const button = f.document.querySelector('#block-timer button');
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  let layout = model.moveHomeSection(f.settings.homeLayout, 'timer', 'main', 'today');
  layout = layout.map((item) => (item.id === 'recent' ? { ...item, visible: false } : item));
  f.update(layout);
  assert.equal(f.main.firstElementChild.textContent, '计时器');
  assert.equal(f.main.children[1].id, 'block-timer');
  assert.equal(f.document.querySelector('#block-timer button'), button);
  button.click();
  assert.equal(clicks, 1);
  assert.equal(f.document.querySelector('#block-recent').hasAttribute('data-av-home-hidden'), true);
  assert.equal(f.document.querySelector('#unknown').parentElement, f.side);
  f.update(model.defaultHomeLayout());
  assert.equal(f.document.querySelector('.padding').innerHTML, f.initial);
  f.scope.dispose();
});

test('all-hidden mode remains recoverable and empty columns collapse', () => {
  const f = fixture();
  f.document.querySelector('#unknown').previousElementSibling.remove();
  f.document.querySelector('#unknown').remove();
  f.update(f.settings.homeLayout.map((item) => ({ ...item, visible: false })));
  assert.ok(f.document.querySelector('.asterveil-home-empty'));
  assert.ok(f.main.hasAttribute('data-av-home-empty'));
  f.update(f.settings.homeLayout.map((item) => ({ ...item, visible: item.id === 'today' })));
  assert.ok(f.main.parentElement.hasAttribute('data-av-home-single'));
  assert.equal(f.document.querySelector('.asterveil-home-empty'), null);
  f.adapter.update(new URL('https://jx.7fa4.cn:8888/'), { ...f.settings, enabled: false });
  assert.equal(f.document.querySelector('[data-av-home-hidden]'), null);
  f.scope.dispose();
});

test('repeated changes, navigation and disposal restore original order', () => {
  const f = fixture();
  f.update(model.moveHomeSection(f.settings.homeLayout, 'today', 'side', 'progress'));
  f.update(model.moveHomeSection(f.settings.homeLayout, 'best', 'side', null));
  f.adapter.update(new URL('https://jx.7fa4.cn:8888/problems'), f.settings);
  assert.equal(f.document.querySelector('.padding').innerHTML, f.initial);
  f.update(model.moveHomeSection(f.settings.homeLayout, 'timer', 'main', null));
  f.scope.dispose();
  assert.equal(f.document.querySelector('.padding').innerHTML, f.initial);
});

test('handles replaced block content without resurrecting removed nodes', async () => {
  const f = fixture();
  const layout = model
    .moveHomeSection(f.settings.homeLayout, 'timer', 'main', 'today')
    .map((item) => (item.id === 'timer' ? { ...item, visible: false } : item));
  f.update(layout);
  const old = f.document.querySelector('#block-timer');
  const replacement = f.document.createElement('div');
  replacement.className = 'ui bottom attached segment';
  replacement.id = 'replacement';
  old.replaceWith(replacement);
  await f.flush();
  assert.ok(replacement.hasAttribute('data-av-home-hidden'));
  f.scope.dispose();
  assert.equal(old.isConnected, false);
  assert.ok(replacement.isConnected);
  assert.equal(replacement.parentElement, f.side);
  assert.equal(replacement.previousElementSibling.textContent, '计时器');
});

test('reapplies saved layout after the site replaces the grid', async () => {
  const f = fixture();
  const layout = model.moveHomeSection(f.settings.homeLayout, 'timer', 'main', 'today');
  f.update(layout);
  f.document.querySelector('.padding').innerHTML = f.initial;
  await f.flush();
  const main = f.document.querySelector('.ten.column');
  assert.equal(main.firstElementChild.textContent, '计时器');
  f.scope.dispose();
  assert.equal(f.document.querySelector('.padding').innerHTML, f.initial);
});
