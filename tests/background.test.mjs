import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
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
        clearTimeout,
        console,
        ...globals,
        require(name) {
          if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
          if (name.endsWith('?inline')) return { default: '' };
          return load(resolve(dirname(path), `${name}.ts`));
        },
      },
    );
    return exports;
  }
  return load;
}
const load = loader();
const { defaultSettings, decodeSettings } = load('src/shared/settings.ts');
const { isSettingsRequest } = load('src/shared/protocol.ts');
const { createSettingsService } = load('src/background/settings-service.ts');
const image = 'data:image/webp;base64,QUJD';

test('old settings remain usable; background accepts bounded raster data and valid overlays only', () => {
  const old = defaultSettings();
  delete old.background;
  const settings = decodeSettings(old);
  assert.equal(settings.background.image, null);
  assert.equal(settings.background.enabled, false);
  for (const invalid of [
    'https://example.com/a.png',
    'data:image/svg+xml;base64,QUJD',
    `${image}");}`,
    `data:image/png;base64,${'A'.repeat(1_500_000)}`,
    undefined,
  ]) {
    assert.equal(
      isSettingsRequest({
        channel: 'asterveil',
        type: 'settings.background.image',
        image: invalid,
      }),
      false,
    );
    assert.throws(() =>
      decodeSettings({ ...old, background: { enabled: true, overlay: 35, image: invalid } }),
    );
  }
  for (const overlay of [-1, 101, 0.5, NaN, '35']) {
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.background.overlay', overlay }),
      false,
    );
  }
  for (const valid of [image, null]) {
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.background.image', image: valid }),
      true,
    );
  }
});

test('concurrent edits preserve image and preferences; failed replacement preserves the saved image', async () => {
  let stored = defaultSettings();
  let fail = false;
  const service = createSettingsService({
    read: async () => decodeSettings(stored),
    write: async (settings) => {
      if (fail) throw new Error('quota');
      stored = settings;
    },
  });
  await Promise.all([
    service({ type: 'settings.background.image', image }),
    service({ type: 'settings.background.overlay', overlay: 60 }),
    service({ type: 'settings.accent', color: '#cf5683' }),
    service({ type: 'settings.background.enabled', enabled: false }),
  ]);
  assert.equal(stored.background.image, image);
  assert.equal(stored.background.overlay, 60);
  assert.equal(stored.background.enabled, false);
  assert.equal(stored.accentColor, '#cf5683');
  fail = true;
  await assert.rejects(
    service({ type: 'settings.background.image', image: `${image}AAAA` }),
    /quota/,
  );
  assert.equal(stored.background.image, image);
  fail = false;
  await service({ type: 'settings.background.image', image: null });
  assert.equal(stored.background.image, null);
  assert.equal(stored.background.enabled, false);
  assert.equal(stored.background.overlay, 60);
});

test('import rejects unsupported and oversized files before decoding and releases decoded images', async () => {
  let decoded = 0;
  let closed = 0;
  let drawn;
  let canvas;
  let encodingFails = false;
  const local = loader({
    createImageBitmap: async () => {
      decoded++;
      return { width: 4000, height: 2000, close: () => closed++ };
    },
    document: {
      createElement: () => {
        canvas = {
          getContext: () => ({
            drawImage: (...args) => {
              drawn = args;
            },
          }),
          toDataURL: () => {
            if (encodingFails) throw new Error('encode failed');
            return image;
          },
        };
        return canvas;
      },
    },
  });
  const { importBackgroundImage } = local('src/platform/background-image.ts');
  await assert.rejects(importBackgroundImage({ type: 'image/svg+xml', size: 10 }));
  await assert.rejects(importBackgroundImage({ type: 'image/png', size: 21 * 1024 * 1024 }));
  assert.equal(decoded, 0);
  assert.equal(await importBackgroundImage({ type: 'image/png', size: 100 }), image);
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 960);
  assert.deepEqual(drawn.slice(1), [0, 0, 4000, 2000, 0, 0, 1920, 960]);
  assert.equal(closed, 1);
  encodingFails = true;
  await assert.rejects(importBackgroundImage({ type: 'image/png', size: 100 }), /encode failed/);
  assert.equal(closed, 2);
});

test('theme removes backgrounds on disable, unsupported navigation and disposal, and restores on return', () => {
  const { document } = parseHTML(
    '<html><body><div class="pusher">Original content</div></body></html>',
  );
  const local = loader({
    document,
    window: { setTimeout, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  });
  const { Scope } = local('src/core/scope.ts');
  const { createPageTheme } = local('src/site/theme.ts');
  const scope = new Scope();
  const home = new URL('https://jx.7fa4.cn:8888/');
  const theme = createPageTheme(scope, home);
  const settings = { ...defaultSettings(), background: { image, overlay: 35, enabled: true } };
  const style = document.querySelector('style[data-asterveil="background"]');
  theme.update(home, settings);
  assert.ok(style.textContent.includes(image));
  assert.ok(style.textContent.includes('@media screen'));
  theme.update(home, { ...settings, colorMode: 'dark' });
  assert.equal(document.documentElement.getAttribute('data-asterveil-scheme'), 'dark');
  assert.ok(style.textContent.includes('var(--av-background-strength, 35%)'));
  assert.ok(style.textContent.includes('background: transparent !important'));
  const { previewBackgroundOverlay } = local('src/shared/background-preview.ts');
  const preview = document.querySelector('style[data-asterveil="background-preview"]');
  previewBackgroundOverlay(72);
  assert.ok(preview.textContent.includes('72%'));
  assert.equal(settings.background.overlay, 35);
  previewBackgroundOverlay(undefined);
  assert.equal(preview.textContent, '');
  assert.ok(!style.textContent.includes('.ui.table > thead'));
  for (const disabled of [
    { ...settings, enabled: false },
    { ...settings, modules: { ...settings.modules, 'ui-polish': false } },
    { ...settings, background: { ...settings.background, enabled: false } },
    { ...settings, background: { ...settings.background, image: null } },
  ]) {
    theme.update(home, disabled);
    assert.equal(style.textContent, '');
    theme.update(home, settings);
    assert.ok(style.textContent.includes(image));
  }
  theme.update(new URL('/download', home), settings);
  assert.equal(style.textContent, '');
  theme.update(home, settings);
  assert.ok(style.textContent.includes(image));
  scope.dispose();
  assert.equal(document.querySelectorAll('style').length, 0);
  assert.equal(document.documentElement.hasAttribute('data-asterveil-appearance'), false);
  assert.equal(document.body.textContent, 'Original content');
});

test('retired background modes are dropped without losing the image or overlay', async () => {
  const old = {
    ...defaultSettings(),
    background: { image, enabled: true, overlay: 35, mode: 'full' },
  };
  for (const mode of ['full', 'page', undefined]) {
    const migrated = decodeSettings({ ...old, background: { ...old.background, mode } });
    assert.equal(migrated.background.image, image);
    assert.equal(migrated.background.enabled, true);
    assert.equal(migrated.background.overlay, 35);
    assert.equal('mode' in migrated.background, false);
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.background.mode', mode }),
      false,
    );
  }
  let stored = decodeSettings(old);
  const service = createSettingsService({
    read: async () => stored,
    write: async (next) => {
      stored = next;
    },
  });
  await service({ type: 'settings.background.overlay', overlay: 50 });
  assert.equal(stored.background.image, image);
  assert.equal(stored.background.overlay, 50);
  assert.equal('mode' in stored.background, false);
});

test('crop selection clamps reverse drags, respects ratios, and stays inside image while moving', () => {
  const { cropBetween, centeredCrop, moveCrop } = load('src/shared/image-crop.ts');
  const crop = cropBetween({ x: 900, y: 700 }, { x: -10, y: -20 }, 1000, 800);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
  assert.equal(crop.width, 900);
  assert.equal(crop.height, 700);
  for (const ratio of [1, 16 / 9, 9 / 16]) {
    const selected = centeredCrop(1000, 800, ratio);
    assert.ok(Math.abs(selected.width / selected.height - ratio) < 0.0001);
    const moved = moveCrop(selected, 10000, -10000, 1000, 800);
    assert.equal(moved.y, 0);
    assert.equal(moved.x + moved.width, 1000);
  }
});

test('image export uses only selected source pixels and rejects empty/out-of-bounds crops', () => {
  let drawn;
  const local = loader({
    document: {
      createElement: () => ({
        getContext: () => ({
          drawImage: (...args) => {
            drawn = args;
          },
        }),
        toDataURL: () => image,
      }),
    },
  });
  const { encodeBackgroundImage } = local('src/platform/background-image.ts');
  const bitmap = { width: 1000, height: 800 };
  assert.equal(encodeBackgroundImage(bitmap, { x: 100, y: 200, width: 400, height: 300 }), image);
  assert.deepEqual(drawn.slice(1), [100, 200, 400, 300, 0, 0, 400, 300]);
  for (const crop of [
    { x: -1, y: 0, width: 100, height: 100 },
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 900, y: 0, width: 200, height: 100 },
    { x: 0, y: NaN, width: 100, height: 100 },
  ])
    assert.throws(() => encodeBackgroundImage(bitmap, crop));
});

test('crop borders expose eight resize targets and constrain edge resizing to the image', () => {
  const { hitCrop, resizeCrop } = load('src/shared/image-crop.ts');
  const crop = { x: 100, y: 100, width: 400, height: 200 };
  for (const [x, y, handle] of [
    [100, 100, 'nw'],
    [500, 100, 'ne'],
    [100, 300, 'sw'],
    [500, 300, 'se'],
    [300, 100, 'n'],
    [300, 300, 's'],
    [100, 200, 'w'],
    [500, 200, 'e'],
    [300, 200, 'move'],
    [50, 50, 'new'],
  ]) {
    assert.equal(hitCrop(crop, { x, y }, 10), handle);
  }
  const free = resizeCrop(crop, 'e', { x: 700, y: 200 }, 1000, 800);
  assert.equal(free.width, 600);
  assert.equal(free.height, 200);
  for (const handle of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
    for (const point of [
      { x: -500, y: -500 },
      { x: 2000, y: 2000 },
      { x: 350, y: 250 },
    ]) {
      const result = resizeCrop(crop, handle, point, 1000, 800, 2);
      assert.ok(result.x >= 0 && result.y >= 0);
      assert.ok(result.x + result.width <= 1000 && result.y + result.height <= 800);
      assert.ok(Math.abs(result.width - result.height * 2) < 0.0001);
    }
  }
});
