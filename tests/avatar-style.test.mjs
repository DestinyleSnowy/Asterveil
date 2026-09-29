import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
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
    runInNewContext(
      ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports,
        URL,
        AbortController,
        console,
        ...globals,
        require(name) {
          if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
          return name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : require(name);
        },
      },
    );
    return exports;
  }
  return load;
}
const load = loader();
const { avatarDataUrl, avatarStyles, gravatarIdentity } = load('src/shared/avatar.ts');
const { defaultSettings, decodeSettings } = load('src/shared/settings.ts');
const { isSettingsRequest } = load('src/shared/protocol.ts');
const { createSettingsService } = load('src/background/settings-service.ts');

test('old settings default to mosaic; unsupported avatar styles are rejected', () => {
  const old = {
    ...defaultSettings(),
    modules: { ...defaultSettings().modules, 'local-avatars': false },
  };
  delete old.avatarStyle;
  assert.equal(decodeSettings(old).avatarStyle, 'mosaic');
  assert.equal(decodeSettings(old).modules['local-avatars'], false);
  for (const style of ['random', 'person', '', 0, {}, []]) {
    assert.throws(() => decodeSettings({ ...old, avatarStyle: style }));
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.avatar-style', style }),
      false,
    );
  }
  for (const { id: style } of avatarStyles) {
    assert.equal(decodeSettings({ ...old, avatarStyle: style }).avatarStyle, style);
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.avatar-style', style }),
      true,
    );
  }
});

test('avatar selection and concurrent setting writes preserve one another', async () => {
  let stored = defaultSettings();
  const service = createSettingsService({
    read: async () => stored,
    write: async (next) => {
      stored = next;
    },
  });
  await Promise.all([
    service({ type: 'settings.avatar-style', style: 'monster' }),
    service({ type: 'settings.accent', color: '#cf5683' }),
    service({ type: 'settings.module', moduleId: 'local-avatars', enabled: false }),
  ]);
  assert.equal(stored.avatarStyle, 'monster');
  assert.equal(stored.accentColor, '#cf5683');
  assert.equal(stored.modules['local-avatars'], false);
  assert.equal(stored.revision, 3);
});

test('all identities use the selected family, with deterministic and safe variations', () => {
  for (let index = 0; index < 100; index++) {
    const identity = `user-${index}`;
    const petals = avatarDataUrl(identity, 'petals');
    const mosaic = avatarDataUrl(identity, 'mosaic');
    assert.match(decodeURIComponent(petals), /<ellipse /);
    assert.doesNotMatch(decodeURIComponent(mosaic), /<ellipse /);
    assert.equal(petals, avatarDataUrl(identity, 'petals'));
    assert.equal(mosaic, avatarDataUrl(identity));
    const variants = avatarStyles.map(({ id }) => avatarDataUrl(identity, id));
    assert.equal(new Set(variants).size, avatarStyles.length);
    for (const { id } of avatarStyles) {
      const svg = decodeURIComponent(avatarDataUrl(identity, id));
      assert.equal(svg, decodeURIComponent(avatarDataUrl(identity, id)));
      assert.doesNotMatch(svg, /NaN|undefined|Infinity|<script|<image|<foreignObject/);
    }
  }
  for (const { id } of avatarStyles)
    assert.doesNotMatch(
      decodeURIComponent(avatarDataUrl('<script>alert(1)</script>', id)),
      /<script>/,
    );
  assert.equal(gravatarIdentity('https://gravatar.loli.net/avatar/ABC?s=24'), 'abc');
  assert.equal(gravatarIdentity('https://gravatar.com/avatar/abc?s=64'), 'abc');
});

test('style changes replace existing and new avatars, preserve other modules, and restore originals', async () => {
  const original = 'https://gravatar.com/avatar/a?s=32';
  const srcset =
    'https://gravatar.com/avatar/a?s=32 1x, https://gravatar.loli.net/avatar/a?s=64 2x';
  const { document, window } = parseHTML(
    `<html><body><img id="avatar" src="${original}" srcset="${srcset}"><img id="other" src="https://example.com/a.png"></body></html>`,
  );
  const local = loader({
    document,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
  });
  const { ModuleRuntime } = local('src/core/runtime.ts');
  const avatarModule = local('src/features/local-avatars/index.ts').default;
  let otherMounts = 0;
  const runtime = new ModuleRuntime([
    {
      id: 'local-avatars',
      configurationKey: (settings) => settings.avatarStyle,
      matches: () => true,
      load: async () => avatarModule,
    },
    {
      id: 'ui-polish',
      matches: () => true,
      load: async () => ({
        mount() {
          otherMounts++;
        },
      }),
    },
  ]);
  const url = new URL('https://jx.7fa4.cn:8888/');
  const settings = defaultSettings();
  runtime.reconcile(url, settings);
  await setImmediate();
  assert.equal(document.querySelector('#avatar').getAttribute('src'), avatarDataUrl('a', 'mosaic'));
  const changed = { ...settings, avatarStyle: 'petals' };
  runtime.reconcile(url, changed);
  await setImmediate();
  assert.equal(document.querySelector('#avatar').getAttribute('src'), avatarDataUrl('a', 'petals'));
  assert.equal(
    document.querySelector('#avatar').getAttribute('srcset'),
    `${avatarDataUrl('a', 'petals')} 1x, ${avatarDataUrl('a', 'petals')} 2x`,
  );
  assert.equal(otherMounts, 1);
  const added = document.createElement('img');
  added.src = 'https://gravatar.com/avatar/b';
  document.body.append(added);
  await setImmediate();
  assert.equal(added.getAttribute('src'), avatarDataUrl('b', 'petals'));
  for (const { id: avatarStyle } of avatarStyles) {
    runtime.reconcile(url, { ...settings, avatarStyle });
    await setImmediate();
    assert.equal(
      document.querySelector('#avatar').getAttribute('src'),
      avatarDataUrl('a', avatarStyle),
    );
    assert.equal(
      document.querySelector('#avatar').getAttribute('srcset'),
      `${avatarDataUrl('a', avatarStyle)} 1x, ${avatarDataUrl('a', avatarStyle)} 2x`,
    );
    assert.equal(added.getAttribute('src'), avatarDataUrl('b', avatarStyle));
    assert.equal(otherMounts, 1);
  }
  runtime.reconcile(url, { ...settings, avatarStyle: 'sprout', accentColor: '#cf5683' });
  await setImmediate();
  assert.equal(otherMounts, 1);
  runtime.dispose();
  assert.equal(document.querySelector('#avatar').getAttribute('src'), original);
  assert.equal(document.querySelector('#avatar').getAttribute('srcset'), srcset);
  assert.equal(added.getAttribute('src'), 'https://gravatar.com/avatar/b');
  assert.equal(document.querySelector('#other').getAttribute('src'), 'https://example.com/a.png');
});

test('a slow module load cannot mount a superseded avatar style', async () => {
  const { ModuleRuntime } = load('src/core/runtime.ts');
  const loaded = [];
  const mounted = [];
  const runtime = new ModuleRuntime([
    {
      id: 'local-avatars',
      configurationKey: (settings) => settings.avatarStyle,
      matches: () => true,
      load: () => new Promise((resolve) => loaded.push(resolve)),
    },
  ]);
  const url = new URL('https://jx.7fa4.cn:8888/');
  runtime.reconcile(url, defaultSettings());
  await setImmediate();
  runtime.reconcile(url, { ...defaultSettings(), avatarStyle: 'petals' });
  await setImmediate();
  for (const complete of loaded)
    complete({
      mount({ settings }) {
        mounted.push(settings.avatarStyle);
      },
    });
  await setImmediate();
  assert.deepEqual(mounted, ['petals']);
  runtime.dispose();
});
