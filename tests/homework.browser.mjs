import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { katexAssets } from '../build/katex-assets.ts';
import { lightEdition } from '../build/light-edition.ts';

const out = resolve('.tmp/homework-browser');
await mkdir(out, { recursive: true });
await build({
  configFile: false,
  logLevel: 'warn',
  define: { __ASTERVEIL_PDF__: 'false' },
  plugins: [
    katexAssets(),
    lightEdition(),
    {
      name: 'homework-fixture',
      enforce: 'pre',
      resolveId(id) {
        if (id.endsWith('homework-fixture')) return '\0homework-fixture';
        if (id === 'wxt/browser') return '\0wxt/browser';
      },
      load(id) {
        if (id === '\0wxt/browser')
          return 'export const browser = {storage:{local:{get:async()=>({}),set:async value=>{window.savedDraft=value}}}};';
        if (id === '\0homework-fixture')
          return `
        import feature from ${JSON.stringify(resolve('src/features/homework/index.ts'))};
        import { Scope } from ${JSON.stringify(resolve('src/core/scope.ts'))};
        import { renderMarkdown } from ${JSON.stringify(resolve('src/features/homework/markdown.ts'))};
        window.renderMarkdown = renderMarkdown;
        window.scope = new Scope();
        feature.mount({scope:window.scope,url:new URL(location.href)});
      `;
      },
    },
  ],
  build: {
    outDir: out,
    emptyOutDir: false,
    lib: {
      entry: 'homework-fixture',
      name: 'HomeworkFixture',
      formats: ['iife'],
      fileName: () => 'bundle.js',
    },
  },
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
});
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://localhost/problem/1', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><style>body{margin:20px;font-family:system-ui;background:#f6f8fc}h1{font-size:20px}</style><div class="ui main container"><h1>H1 Markdown Editor</h1><form id="submit_code" method="post" action="/problem/1/submit"><div><input type="file" name="answer" aria-label="原始上传"></div></form></div><input aria-label="编辑器外">',
    }),
  );
  await page.goto('http://localhost/problem/1');
  await page.addScriptTag({ path: resolve(out, 'bundle.js') });
  const editor = page.getByRole('textbox', { name: 'Markdown', exact: true });
  const query = page.getByRole('textbox', { name: '查找', exact: true });
  const replacement = page.getByRole('textbox', { name: '替换为', exact: true });
  const count = page.locator('.search-count');
  const button = (action) => page.locator(`[data-search="${action}"]`);
  const selection = () => editor.evaluate((el) => [el.selectionStart, el.selectionEnd]);
  const settle = () => page.waitForTimeout(450);

  await editor.fill('Alpha alpha ALPHA [x] [x]');
  await editor.evaluate((el) => el.setSelectionRange(0, 5));
  await editor.press('Control+f');
  assert.equal(await query.inputValue(), 'Alpha');
  assert.equal(await count.textContent(), '1/3');
  assert.equal(await page.locator('.search-highlight mark').textContent(), 'Alpha');
  assert.equal(await page.locator('.search-highlight').getAttribute('aria-hidden'), 'true');
  await query.press('Enter');
  assert.deepEqual(await selection(), [6, 11]);
  await query.press('Shift+Enter');
  assert.deepEqual(await selection(), [0, 5]);
  await button('previous').click();
  assert.deepEqual(await selection(), [12, 17]);
  await button('case').click();
  assert.equal(await count.textContent(), '1/1');
  await button('case').click();
  await query.fill('[x]');
  assert.equal(await count.textContent(), '1/2');
  await replacement.fill('$&\\');
  await replacement.press('Enter');
  assert.equal(await editor.inputValue(), 'Alpha alpha ALPHA $&\\ [x]');
  await button('replace-all').click();
  assert.equal(await editor.inputValue(), 'Alpha alpha ALPHA $&\\ $&\\');
  await settle();
  assert.equal(
    await page.evaluate(() => Object.values(window.savedDraft)[0].markdown),
    await editor.inputValue(),
  );
  assert.equal(
    await editor.evaluate((el) => {
      const expected = document.createElement('article');
      window.renderMarkdown(el.value, expected);
      return expected.innerHTML === el.getRootNode().querySelector('.paper').innerHTML;
    }),
    true,
  );
  await query.press('Escape');
  assert.equal(await query.isVisible(), false);
  assert.equal(await editor.evaluate((el) => el.getRootNode().activeElement === el), true);
  await editor.press('Control+z');
  assert.equal(await editor.inputValue(), 'Alpha alpha ALPHA $&\\ [x]');
  await editor.press('Control+y');
  assert.equal(await editor.inputValue(), 'Alpha alpha ALPHA $&\\ $&\\');

  await editor.fill('İ 😀 alpha alpha');
  await editor.press('Control+h');
  assert.equal(await replacement.evaluate((el) => el.getRootNode().activeElement === el), true);
  await query.fill('alpha');
  assert.deepEqual(await selection(), [5, 10]);
  await replacement.fill('');
  await button('replace-all').click();
  assert.equal(await editor.inputValue(), 'İ 😀  ');
  assert.equal(await count.textContent(), '0/0');
  assert.equal(await button('replace').isDisabled(), true);
  await query.fill('');
  assert.equal(await count.textContent(), '0/0');

  await editor.fill('aa aa aa');
  await query.fill('aa');
  await replacement.fill('aaaa');
  await button('replace').click();
  assert.equal(await editor.inputValue(), 'aaaa aa aa');
  assert.deepEqual(await selection(), [5, 7]);
  await editor.evaluate((el) => {
    el.readOnly = true;
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-asterveil-homework]')
        .shadowRoot.querySelector('[data-search="replace"]').disabled,
  );
  await replacement.press('Enter');
  assert.equal(await editor.inputValue(), 'aaaa aa aa');
  await editor.evaluate((el) => {
    el.readOnly = false;
    el.maxLength = 10;
  });
  await button('replace-all').click();
  assert.equal(await editor.inputValue(), 'aaaa aa aa');
  assert.ok((await page.locator('.search-error').textContent()).includes('10'));
  await editor.evaluate((el) => {
    el.maxLength = 200000;
  });

  const longSource = `${'长文本自动换行。'.repeat(1500)}\n最后的匹配`;
  await editor.fill(longSource);
  await query.fill('最后的匹配');
  assert.equal(await count.textContent(), '1/1');
  assert.deepEqual(await selection(), [longSource.indexOf('最后的匹配'), longSource.length]);
  assert.ok(await editor.evaluate((el) => el.scrollTop > 500));
  assert.ok(
    await page.locator('.search-highlight mark').evaluate((el) => {
      const match = el.getBoundingClientRect();
      const pane = el.closest('.source-pane').getBoundingClientRect();
      return match.top >= pane.top && match.bottom <= pane.bottom;
    }),
  );
  await query.fill('长文本');
  assert.equal(await editor.evaluate((el) => el.scrollTop), 0);

  const sample = await readFile(new URL('./fixtures/homework-math.md', import.meta.url), 'utf8');
  await editor.fill(sample);
  await settle();
  assert.equal(await page.locator('.paper .katex').count(), 29);
  assert.equal(await page.locator('.paper .katex-display').count(), 2);
  assert.equal(await page.locator('.paper .katex-error').count(), 0);
  const cases = [
    [String.raw`单 \(x\) 双 \\(y\\) $z$ $$w$$`, 4],
    [String.raw`\\[\begin{aligned}a&=1\\b&=2\end{aligned}\\]`, 1],
    [String.raw`\[x+y\]`, 1],
    ['```tex\n\\\\(x\\\\)\n```\n\n`\\\\[y\\\\]`\n\n    \\\\(z\\\\)', 0],
    [String.raw`未闭合 \\(x 和 \\[y`, 0],
    [
      String.raw`> 引用 \\(x\\)

- 列表 \\(y\\)

| A | B |
|---|---|
| \\(z\\) | $w$ |`,
      4,
    ],
    [sample, 29],
  ];
  for (const [source, expected] of cases) {
    const result = await page.evaluate((source) => {
      const normal = document.createElement('article');
      const mapped = document.createElement('article');
      const chat = document.createElement('article');
      const anchors = [];
      window.renderMarkdown(source, normal);
      window.renderMarkdown(source, mapped, { anchors });
      window.renderMarkdown(source, chat, { chat: true });
      return {
        count: normal.querySelectorAll('.katex').length,
        errors: normal.querySelectorAll('.katex-error').length,
        equal: normal.innerHTML === mapped.innerHTML,
        normal: normal.innerHTML,
        mapped: mapped.innerHTML,
        chatCount: chat.querySelectorAll('.katex').length,
        valid: anchors.every(
          (a) => mapped.contains(a.element) && a.offset >= 0 && a.offset <= source.length,
        ),
        tex: [...normal.querySelectorAll('annotation')].map((el) => el.textContent),
      };
    }, source);
    assert.equal(result.count, expected, source);
    assert.equal(result.chatCount, expected, source);
    assert.equal(result.errors, 0, source);
    assert.equal(
      result.equal,
      true,
      JSON.stringify({ source, normal: result.normal, mapped: result.mapped }),
    );
    if (expected > 0) assert.equal(result.valid, true, source);
    if (source.includes('aligned'))
      assert.deepEqual(result.tex, [String.raw`\begin{aligned}a&=1\\b&=2\end{aligned}`]);
  }
  await query.fill('PC');
  await replacement.fill('PD');
  await page.screenshot({ path: resolve(out, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.body.style.cssText =
      'margin:12px;background:linear-gradient(130deg,#374969,#121723);color:#d4dae3;--av-paper:#1b202a;--av-surface:#202633;--av-border:#3a4252;--av-text:#d4dae3;--av-muted:#a3afbf;--av-accent:#8ab8f5;--av-tint:#27374d;--av-heading:#edf0f5;--av-scheme:dark';
  });
  await page.screenshot({ path: resolve(out, 'mobile-dark.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const panelBox = await page.locator('.search-panel').boundingBox();
  for (const action of ['case', 'previous', 'next', 'close', 'replace', 'replace-all']) {
    const box = await button(action).boundingBox();
    assert.ok(box.x >= panelBox.x && box.x + box.width <= panelBox.x + panelBox.width + 1, action);
  }
  await button('close').click();
  await page.getByRole('textbox', { name: '编辑器外', exact: true }).focus();
  assert.equal(
    await page.getByRole('textbox', { name: '编辑器外', exact: true }).evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
    true,
  );
  assert.equal(await query.isVisible(), false);
  await page.evaluate(() => window.scope.dispose());
  assert.equal(await editor.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: find/replace, literal Unicode matches, native undo/redo, saving/preview, read-only/length guards, long text, 29 sample formulas, code/math boundaries, render parity, mobile dark layout, shortcut scope and cleanup.',
  );
} finally {
  await browser.close();
}
