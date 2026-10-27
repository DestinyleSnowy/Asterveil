import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const out = resolve('.tmp/code-editor-browser');
const assets = resolve('node_modules/monaco-editor/min');
const font = await readFile(
  'node_modules/@fontsource/fira-mono/files/fira-mono-latin-400-normal.woff2',
);
await mkdir(out, { recursive: true });
const code = [
  '#include <cstdio>',
  '#include <algorithm>',
  '#define int long long',
  "const int N = 20, M = 200'0000;",
  'int n;',
  'int a[N], stk[N], p[N], ans[M];',
  'int len = 0, top = 0, cur = 1;',
  'void dfs(int step, int s) {',
  '    if (step > 2 * n) {',
  '        ans[++len] = s;',
  '        return;',
  '    }',
  '    // 中文注释，保留缩进与符号。',
  '}',
].join('\n');
const fixture = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>
@font-face{font-family:"Late Editor Mono";src:url('/editor-font.woff2') format('woff2');font-display:swap}
body{margin:0;font:14px system-ui;background:#fcfafb}.ui.main.container{width:90%;max-width:1155px;margin:32px auto}
#submit_code>.ui.grid{display:grid;grid-template-columns:200px minmax(0,1fr);border:1px solid #eadce2;border-radius:10px;overflow:hidden;background:white}
#languages-menu{display:flex;flex-direction:column;border-right:1px solid #eadce2}#languages-menu button{border:0;border-bottom:1px solid #eee;background:white;text-align:left;padding:16px}
#languages-menu button.active{background:#f9f1f5;color:#bd4476}.editor-column{height:400px;position:relative;min-width:0}.editor{width:100%;height:100%;overflow:hidden}
.upload{grid-column:1/-1;padding:16px;border-top:1px solid #eee;text-align:center}#submit-button{padding:8px 18px;margin-left:16px}
@media(max-width:600px){#submit_code>.ui.grid{grid-template-columns:100px minmax(0,1fr)}}
</style><body><main class="ui main container"><h1>代码编辑器</h1><form id="submit_code"><div class="ui grid">
<div id="languages-menu"><button type="button" class="item active" data-language="cpp">C++ 17</button><button type="button" class="item" data-language="plaintext">文本</button></div>
<div class="editor-column"><div class="editor" id="editor"></div></div><div class="upload"><label for="answer">或者，上传代码文件</label><input id="answer" name="answer" type="file"><input name="code" type="hidden"><input name="language" value="cpp" type="hidden"><button id="submit-button" type="submit">提交</button></div>
</div></form></main><script src="/monaco/vs/loader.js"></script><script>
require.config({paths:{vs:'/monaco/vs'}});
require(['vs/editor/editor.main'],function(){
  window.editor=monaco.editor.create(document.getElementById('editor'),{
    value:${JSON.stringify(code)},language:'cpp',fontFamily:'"Late Editor Mono", Consolas, monospace',
    fontSize:14,lineHeight:22,minimap:{enabled:false},scrollBeyondLastLine:false,automaticLayout:false,contextmenu:false,
  });
  window.measurements=0;
  const remeasure=monaco.editor.remeasureFonts;
  monaco.editor.remeasureFonts=function(){window.measurements++;return remeasure();};
  editor.setSelection(new monaco.Selection(10,15,10,18));editor.focus();
  document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-language]').forEach(item=>item.classList.toggle('active',item===button));
    monaco.editor.setModelLanguage(editor.getModel(),button.dataset.language);
    document.querySelector('[name=language]').value=button.dataset.language;
  }));
  document.querySelector('#submit_code').addEventListener('submit',event=>{
    event.preventDefault();document.querySelector('[name=code]').value=editor.getValue();
    const data=new FormData(event.currentTarget);window.submitted={code:data.get('code'),language:data.get('language'),file:data.get('answer').name};
  });
});</script></body></html>`;

for (const product of ['Asterveil', 'Asterveil Pro']) {
  const context = await chromium.launchPersistentContext(await mkdtemp(`${out}/profile-`), {
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    headless: true,
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  context.setDefaultTimeout(12_000);
  let releaseFont;
  const fontGate = new Promise((resolve) => {
    releaseFont = resolve;
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: resolve('.output', product) });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() =>
      chrome.storage.local.set({
        'asterveil:settings': {
          schemaVersion: 1,
          revision: 0,
          enabled: false,
          colorMode: 'light',
          modules: {
            'ui-polish': false,
            'local-avatars': false,
            'user-names': false,
            'home-layout': false,
            homework: false,
          },
        },
      }),
    );
    const update = (fields) =>
      worker.evaluate(async (fields) => {
        const key = 'asterveil:settings';
        const current = (await chrome.storage.local.get(key))[key];
        await chrome.storage.local.set({
          [key]: {
            ...current,
            ...fields,
            modules: { ...current.modules, ...fields.modules },
            revision: current.revision + 1,
          },
        });
      }, fields);
    await context.route(/^https:\/\/(?:jx|in)\.7fa4\.cn:8888\//, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/editor-font.woff2') {
        await fontGate;
        return route.fulfill({ contentType: 'font/woff2', body: font }).catch(() => undefined);
      }
      if (path.startsWith('/monaco/')) {
        const file = resolve(assets, path.slice('/monaco/'.length));
        assert.ok(file.startsWith(`${assets}${sep}`));
        try {
          return await route.fulfill({
            contentType: extname(file) === '.css' ? 'text/css' : 'text/javascript',
            body: await readFile(file),
          });
        } catch {
          return route.fulfill({ status: 404, body: '' });
        }
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('https://jx.7fa4.cn:8888/problem/1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        typeof window.editor?.getSelection === 'function' &&
        window.editor.getSelection().endColumn === 18,
    );
    releaseFont();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const geometry = () =>
      page.evaluate(() => {
        const line = [...document.querySelectorAll('.view-line')].find((line) =>
          line.textContent.includes('ans[++len]'),
        );
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let offset = 0;
        const index = line.textContent.indexOf('len');
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (index >= offset && index < offset + node.length) range.setStart(node, index - offset);
          if (index + 3 > offset && index + 3 <= offset + node.length) {
            range.setEnd(node, index + 3 - offset);
            break;
          }
          offset += node.length;
        }
        const text = range.getBoundingClientRect();
        const cursor = document.querySelector('.cursor').getBoundingClientRect();
        const selected = document.querySelector('.selected-text')?.getBoundingClientRect();
        return {
          text: { x: text.x, right: text.right, width: text.width, y: text.y + text.height / 2 },
          cursor: cursor.x,
          selection: selected
            ? { x: selected.x, right: selected.right, width: selected.width }
            : null,
          code: window.editor.getValue(),
          line: window.editor.getSelection().endLineNumber,
          column: window.editor.getSelection().endColumn,
          width: window.editor.getLayoutInfo().width,
          container: document.querySelector('#editor').clientWidth,
        };
      });
    const broken = await geometry();
    assert.ok(
      Math.abs(broken.cursor - broken.text.right) > 4,
      'late font must reproduce the original misaligned cursor',
    );
    await page.locator('#submit_code').screenshot({ path: resolve(out, `${product}-before.png`) });
    await update({ enabled: true });
    await page.waitForFunction(() => window.measurements > 0);
    const accurate = async () => {
      await page.waitForFunction(() => {
        const line = [...document.querySelectorAll('.view-line')].find((line) =>
          line.textContent.includes('ans[++len]'),
        );
        return (
          line &&
          window.editor.getLayoutInfo().width === document.querySelector('#editor').clientWidth
        );
      });
      const actual = await geometry();
      assert.ok(Math.abs(actual.cursor - actual.text.right) <= 1.1, JSON.stringify(actual));
      assert.ok(Math.abs(actual.selection.x - actual.text.x) <= 1.1, JSON.stringify(actual));
      assert.ok(
        Math.abs(actual.selection.right - actual.text.right) <= 1.1,
        JSON.stringify(actual),
      );
      assert.equal(actual.code, code);
      assert.equal(actual.line, 10);
      assert.equal(actual.column, 18);
    };
    await accurate();
    await page.locator('#submit_code').screenshot({ path: resolve(out, `${product}-after.png`) });
    const target = (await geometry()).text;
    await page.mouse.move(target.x + 0.5, target.y);
    await page.mouse.down();
    await page.mouse.move(target.right - 0.5, target.y, { steps: 6 });
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => {
        const range = window.editor.getSelection();
        return [range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn];
      }),
      [10, 15, 10, 18],
      'dragging over the rendered word must select that exact word',
    );
    // Native keyboard selection, replacement and undo must use the same positions as the renderer.
    await page.locator('.inputarea').press('ArrowLeft');
    await page.locator('.inputarea').press('Control+Shift+ArrowRight');
    await page.keyboard.type('length');
    assert.match(await page.evaluate(() => window.editor.getValue()), /ans\[\+\+length\]/);
    await page.locator('.inputarea').press('Control+z');
    assert.equal(await page.evaluate(() => window.editor.getValue()), code);
    await page.evaluate(() => window.editor.setSelection(new monaco.Selection(10, 15, 10, 18)));
    const beforeLaterFont = await page.evaluate(() => window.measurements);
    await page.evaluate(async () => {
      document.fonts.add(new FontFace('Later Editor Mono', 'url(/editor-font.woff2?second=1)'));
      window.editor.updateOptions({ fontFamily: '"Later Editor Mono", Consolas, monospace' });
      await document.fonts.ready;
    });
    await page.waitForFunction((count) => window.measurements > count, beforeLaterFont);
    await accurate();
    for (const [width, scheme] of [
      [1024, 'light'],
      [390, 'dark'],
      [1440, 'light'],
    ]) {
      await update({ modules: { 'ui-polish': true }, colorMode: scheme });
      await page.setViewportSize({ width, height: 900 });
      await accurate();
      await page
        .locator('#submit_code')
        .screenshot({ path: resolve(out, `${product}-${scheme}-${width}.png`) });
    }
    await page.getByRole('button', { name: '文本', exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.editor.getModel().getLanguageIdentifier().language),
      'plaintext',
    );
    await page
      .locator('#answer')
      .setInputFiles({ name: 'solution.cpp', mimeType: 'text/plain', buffer: Buffer.from(code) });
    await page.getByRole('button', { name: '提交', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.submitted), {
      code,
      language: 'plaintext',
      file: 'solution.cpp',
    });
    await update({ enabled: false });
    await page.waitForTimeout(150);
    const calls = await page.evaluate(() => window.measurements);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => window.measurements),
      calls,
      'paused extension releases its font and resize listeners',
    );
    assert.deepEqual(errors, []);
    console.log(
      `${product}: reproduced late-font offset ${Math.round(Math.abs(broken.cursor - broken.text.right) * 10) / 10}px; corrected selection/cursor, resize, keyboard undo, language/file submission and pause cleanup passed.`,
    );
  } finally {
    releaseFont();
    await context.close();
  }
}
