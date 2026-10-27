import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'marked';
import { chromium } from 'playwright';

const out = resolve('.tmp/problem-copy-browser');
await mkdir(out, { recursive: true });
const description =
  '计算 $a+b$。\n\n```markdown\n## 输入格式\n这仍然属于代码。\n```\n\n### 说明\n\n保留公式与代码。';
const source = `# 示例题目\n\n题目背景\n\n## 题目描述\n\n${description}\n\n## 输入格式\n两个整数。\n\n## 输出格式\n一个整数。`;
const escapeMarkup = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const sourceButton = '[data-asterveil="copy-problem-source"]';
const descriptionButton = '[data-asterveil="copy-problem-description"]';
const origin = 'https://jx.7fa4.cn:8888';
function fixture(path) {
  const sourcePath = path.startsWith('/contest/')
    ? `${path}/markdown/html`
    : '/problem/1/markdown/html';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
    body{margin:0;font:15px system-ui;background:#f8f9fc}
    .ui.main.container{margin:40px auto;width:90%;max-width:1100px}
    .ui.buttons{display:inline-flex;flex-wrap:wrap;border-radius:8px}
    .ui.button{display:inline-block;padding:10px 16px;border:0;border-radius:4px;background:#ececf2;color:#343444;font:inherit;text-decoration:none;cursor:pointer}
    .ui.buttons>.ui.button{border-radius:0}
    .ui.buttons>.ui.button:first-child{border-top-left-radius:8px;border-bottom-left-radius:8px}
    .ui.buttons>.ui.button:last-child{border-top-right-radius:8px;border-bottom-right-radius:8px}
    .font-content{padding:20px;background:white}pre{white-space:pre-wrap}
    </style></head><body><main class="ui main container"><div class="ui grid"><div class="row"><div class="column"><h1>P1. 示例题目</h1><p>时间限制：1000 ms</p><div class="ui buttons"><a id="native-source" class="small ui button" href="${sourcePath}">题面源码</a><a class="small ui button" href="#submit_code">提交</a><a class="small ui button" href="/problem/1/statistics">统计</a></div><div class="ui bottom attached segment font-content"><div>${parse(source)}</div></div></div></div></div></main></body></html>`;
}

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
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: resolve('.output', product) });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() =>
      chrome.storage.local.set({
        'asterveil:settings': {
          schemaVersion: 1,
          revision: 0,
          enabled: true,
          colorMode: 'light',
          modules: { homework: false, 'user-names': false, 'local-avatars': false },
        },
      }),
    );
    let markdown = source;
    let hold;
    const errors = [];
    await context.route(/^https:\/\/(?:jx|in)\.7fa4\.cn:8888\//, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/markdown/html')) {
        if (hold) await hold;
        return route
          .fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<html><body><pre>${escapeMarkup(markdown)}</pre></body></html>`,
          })
          .catch(() => undefined);
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(path) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const settings = async (tab = page) => {
      await tab.getByRole('button', { name: `打开 ${product} 设置`, exact: true }).click();
      await tab.getByRole('button', { name: '功能模块', exact: true }).click();
      await tab
        .locator('.module[data-module-id="problem-copy"] > .row > input[role="switch"]')
        .waitFor();
    };
    const card = page.locator('.module[data-module-id="problem-copy"]');
    const select = async (option, enabled) => {
      await card.locator(`[data-problem-copy="${option}"]`).setChecked(enabled);
      if (option === 'hideOriginal') {
        await page.waitForFunction(
          (value) => document.querySelector('#native-source').hidden === value,
          enabled,
        );
      } else {
        await page.waitForFunction(
          ({ selector, enabled }) => !!document.querySelector(selector) === enabled,
          {
            selector: option === 'source' ? sourceButton : descriptionButton,
            enabled,
          },
        );
      }
    };
    // Capture clipboard writes in this extension's isolated world, leaving the OS clipboard intact.
    async function clipboard(tab, initialize = false) {
      return worker.evaluate(
        async ({ url, initialize }) => {
          const [target] = await chrome.tabs.query({ url });
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: target.id },
            func: (initialize) => {
              if (initialize) {
                window.copyFixture = [];
                navigator.clipboard.writeText = async (text) => {
                  window.copyFixture.push(text);
                };
              }
              return window.copyFixture;
            },
            args: [initialize],
          });
          return result.result;
        },
        { url: tab.url(), initialize },
      );
    }
    async function copy(tab, selector, expected) {
      await tab.locator(selector).click();
      await tab.waitForFunction(
        (selector) => document.querySelector(selector)?.textContent === '已复制',
        selector,
      );
      assert.equal((await clipboard(tab)).at(-1), expected);
    }
    await page.goto(`${origin}/problem/1`);
    await page.locator(descriptionButton).waitFor();
    assert.equal(await page.locator(sourceButton).count(), 1);
    assert.equal(await page.locator('#native-source').isVisible(), true);
    await clipboard(page, true);
    await copy(page, sourceButton, source);
    await copy(page, descriptionButton, description);
    await page.locator('.column > h1').click();
    assert.equal(
      await page.locator(sourceButton).evaluate((node) => getComputedStyle(node).backgroundColor),
      await page
        .locator(descriptionButton)
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    );
    await settings();
    assert.equal(await card.locator('[data-problem-copy="source"]').isChecked(), true);
    assert.equal(await card.locator('[data-problem-copy="description"]').isChecked(), true);
    assert.equal(await card.locator('[data-problem-copy="hideOriginal"]').isChecked(), false);
    await card.screenshot({ path: resolve(out, `${product}-options.png`) });
    await select('source', false);
    await select('hideOriginal', true);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page
      .locator('.column > .ui.buttons')
      .screenshot({ path: resolve(out, `${product}-source-hidden.png`) });
    await copy(page, descriptionButton, description);
    await settings();
    await select('description', false);
    await card.getByRole('switch', { name: '复制题面', exact: true }).uncheck();
    await page.waitForFunction(() => !document.querySelector('#native-source').hidden);
    assert.equal(await card.locator('[data-problem-copy="source"]').isDisabled(), true);
    assert.equal(await page.locator(sourceButton).count(), 0);
    assert.equal(await page.locator(descriptionButton).count(), 0);
    await card.getByRole('switch', { name: '复制题面', exact: true }).check();
    await page.waitForFunction(() => document.querySelector('#native-source').hidden);
    await select('source', true);
    await select('description', true);
    await worker.evaluate(async () => {
      const key = 'asterveil:settings';
      const current = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({
        [key]: {
          ...current,
          revision: current.revision + 1,
          modules: { ...current.modules, 'ui-polish': false },
        },
      });
    });
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute('data-asterveil-appearance'),
    );
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page
      .locator('.column > .ui.buttons')
      .screenshot({ path: resolve(out, `${product}-source-unpolished.png`) });
    await copy(page, descriptionButton, description);
    markdown = '## 输入格式\n这不是题目描述。';
    const copies = (await clipboard(page)).length;
    await page.locator(descriptionButton).click();
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent === '未找到题目描述',
      descriptionButton,
    );
    assert.equal((await clipboard(page)).length, copies);
    markdown = source;
    let release;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    await page.locator(sourceButton).click();
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.disabled,
      sourceButton,
    );
    await settings();
    await card.getByRole('switch', { name: '复制题面', exact: true }).uncheck();
    await page.waitForFunction(() => !document.querySelector('#native-source').hidden);
    release();
    hold = undefined;
    await card.getByRole('switch', { name: '复制题面', exact: true }).check();
    await page.locator(sourceButton).waitFor({ state: 'attached' });
    assert.equal((await clipboard(page)).length, copies);
    const second = await context.newPage();
    await second.goto('https://in.7fa4.cn:8888/contest/9/problem/1');
    await second.locator(descriptionButton).waitFor();
    assert.equal(await second.locator('#native-source').isVisible(), false);
    await clipboard(second, true);
    await copy(second, descriptionButton, description);
    await select('source', false);
    await second.waitForFunction((selector) => !document.querySelector(selector), sourceButton);
    await second.close();
    await worker.evaluate(async () => {
      const key = 'asterveil:settings';
      const current = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({
        [key]: {
          ...current,
          revision: current.revision + 1,
          modules: { ...current.modules, 'ui-polish': true },
          colorMode: 'dark',
        },
      });
    });
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-asterveil-scheme') === 'dark',
    );
    await card.screenshot({ path: resolve(out, `${product}-options-dark.png`) });
    for (const [scheme, fill] of [
      ['light', '#101018'],
      ['dark', '#ffffff'],
    ]) {
      const image = await page.evaluate((fill) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const drawing = canvas.getContext('2d');
        drawing.fillStyle = fill;
        drawing.fillRect(0, 0, 8, 8);
        return canvas.toDataURL('image/png');
      }, fill);
      await worker.evaluate(
        async ({ image, scheme }) => {
          const key = 'asterveil:settings';
          const current = (await chrome.storage.local.get(key))[key];
          await chrome.storage.local.set({
            [key]: {
              ...current,
              revision: current.revision + 1,
              colorMode: scheme,
              background: { image, enabled: true, overlay: 5 },
            },
          });
        },
        { image, scheme },
      );
      await page.waitForFunction(
        ({ image, scheme }) =>
          document.documentElement.getAttribute('data-asterveil-scheme') === scheme &&
          document.querySelector('style[data-asterveil="background"]')?.textContent.includes(image),
        { image, scheme },
      );
      const background = await card.evaluate((node) => getComputedStyle(node).backgroundColor);
      assert.ok(background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)');
      await page.screenshot({ path: resolve(out, `${product}-background-${scheme}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await card.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    await page
      .locator('.settings-dialog')
      .screenshot({ path: resolve(out, `${product}-mobile.png`) });
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.goto(`${origin}/problem/1/answers`);
    await settings();
    assert.equal(await page.locator(descriptionButton).count(), 0);
    assert.equal(await page.locator('#native-source').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      `${product}: source/description copy, independent switches, native-button restoration, cancellation, cross-tab/contest support and responsive settings passed.`,
    );
  } finally {
    await context.close();
  }
}
