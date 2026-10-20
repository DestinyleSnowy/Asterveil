import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve('.tmp/homework-export-browser');
await mkdir(out, { recursive: true });
const sample = await readFile(new URL('./fixtures/homework-export.md', import.meta.url), 'utf8');
const imageUrl = /!\[[^\]]*\]\((https:[^)]+)\)/.exec(sample)[1];

for (const edition of ['Asterveil', 'Asterveil Pro']) {
  const context = await chromium.launchPersistentContext(await mkdtemp(`${out}/profile-`), {
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
    viewport: { width: 1100, height: 850 },
    acceptDownloads: true,
  });
  try {
    const page = context.pages()[0];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 80, 100);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(80, 0, 80, 100);
      return canvas.toDataURL();
    });
    const extraImages = [
      'https://images.example.com/photo.png',
      'http://assets.example.org/photo.png',
      'https://cdn.example.net/diagram.svg',
      'https://redirect.example.org/image',
      'https://cors.example.net/photo.png',
      '/assets/local.png',
      png,
    ];
    const document = `${sample}\n\n${extraImages.map((url, i) => `![图片 ${i}](${url})`).join('\n\n')}`;
    let failImage = false;
    let backgroundReads = 0;
    const backgroundUrls = new Set();
    await context.route(
      /https?:\/\/(images\.openai\.com|[^/]+\.example\.(com|org|net))\//,
      (route) => {
        if (route.request().serviceWorker()) backgroundReads++;
        if (route.request().serviceWorker()) backgroundUrls.add(route.request().url());
        const url = new URL(route.request().url());
        if (url.hostname === 'redirect.example.org')
          return route.fulfill({
            status: 302,
            headers: {
              location: 'https://destination.example.net/photo.png',
              'access-control-allow-origin': 'https://unrelated.invalid',
            },
          });
        // Prevent the routing helper from adding permissive CORS headers:
        // allow a different origin so <img> works while page fetch fails.
        return route.fulfill(
          failImage && url.hostname === 'images.openai.com'
            ? { status: 404, contentType: 'text/plain', body: 'missing' }
            : {
                contentType: url.pathname.endsWith('.svg')
                  ? 'image/svg+xml'
                  : url.hostname === 'images.example.com'
                    ? 'application/octet-stream'
                    : 'image/png',
                headers: {
                  'access-control-allow-origin':
                    url.hostname === 'cors.example.net' ? '*' : 'https://unrelated.invalid',
                },
                body: url.pathname.endsWith('.svg')
                  ? '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><path fill="red" d="M0 0h80v100H0z"/><path fill="blue" d="M80 0h80v100H80z"/></svg>'
                  : Buffer.from(png.split(',')[1], 'base64'),
              },
        );
      },
    );
    await context.route('https://jx.7fa4.cn:8888/**', (route) =>
      route.fulfill(
        new URL(route.request().url()).pathname === '/assets/local.png'
          ? {
              contentType: 'image/png',
              body: Buffer.from(png.split(',')[1], 'base64'),
            }
          : {
              contentType: 'text/html',
              body: '<!doctype html><meta charset="utf-8"><style>body{margin:20px;font-family:system-ui}</style><div class="ui main container"><h1>H1 导出检查</h1><form id="submit_code" method="post" action="/problem/1/submit"><div><input type="file" name="answer"></div></form></div>',
            },
      ),
    );
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('.output', edition) });
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => {
      globalThis.permissionRequests = [];
      globalThis.denyPermission = true;
      const permissions = (globalThis.browser || chrome).permissions;
      const request = permissions.request.bind(permissions);
      permissions.request = (...args) => {
        globalThis.permissionRequests.push(args[0]);
        if (globalThis.denyPermission) return Promise.resolve(false);
        return request(...args);
      };
    });
    const controls = await context.newPage();
    await controls.goto('chrome://extensions');
    const seedPermission = async (hosts) => {
      // Seed Chrome's remembered consent, then exercise the real permissions.request
      // from the editor button. No host is active until that request succeeds.
      await controls.evaluate(
        async ({ id, hosts }) => {
          for (const host of hosts) await chrome.developerPrivate.addHostPermission(id, host);
        },
        { id, hosts },
      );
      await page.bringToFront();
    };
    await page.goto('https://jx.7fa4.cn:8888/problem/1');
    const editor = page.getByRole('textbox', { name: 'Markdown', exact: true });
    await editor.fill(document);
    await page.waitForFunction(() => {
      const img = document
        .querySelector('[data-asterveil-homework]')
        ?.shadowRoot.querySelector('.paper img');
      return img?.complete && img.naturalWidth === 160;
    });
    assert.equal(await page.locator('.paper .katex-error').count(), 0);
    assert.equal(
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return false;
        } catch {
          return true;
        }
      }, imageUrl),
      true,
      'The original page fetch is blocked by CORS',
    );

    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const retry = page.getByRole('button', { name: '授权并重试', exact: true });
    await retry.waitFor({ state: 'visible' });
    assert.equal(backgroundReads, 0, 'No privileged fetch before source permission');
    await page.screenshot({ path: resolve(out, `${edition}-permission.png`) });
    await page.setViewportSize({ width: 440, height: 850 });
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, `${edition}-permission-narrow.png`) });
    await page.setViewportSize({ width: 1100, height: 850 });
    await retry.click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-asterveil-homework]')
        .shadowRoot.querySelector('.status')
        .textContent.includes('未获'),
    );
    assert.equal(backgroundReads, 0, 'Denial must not fetch or export');
    await worker.evaluate(() => {
      globalThis.denyPermission = false;
    });
    const initialHosts = [
      'https://images.openai.com/*',
      'https://images.example.com/*',
      'http://assets.example.org/*',
      'https://cdn.example.net/*',
      'https://redirect.example.org/*',
    ];
    await seedPermission(initialHosts);
    assert.equal(
      await worker.evaluate(
        (hosts) => chrome.permissions.contains({ origins: hosts }),
        initialHosts,
      ),
      false,
    );
    await retry.focus();
    await retry.press('Enter');
    await retry.waitFor({ state: 'visible' });
    assert.equal(
      await worker.evaluate(
        (hosts) => chrome.permissions.contains({ origins: hosts }),
        initialHosts,
      ),
      true,
      'Real permission request from content click succeeded',
    );
    assert.ok(
      (await page.locator('.status').textContent()).includes('授权'),
      await page.locator('.status').textContent(),
    );
    await seedPermission(['https://destination.example.net/*']);
    const downloadPromise = page.waitForEvent('download');
    await retry.click();
    const download = await Promise.race([
      downloadPromise,
      page
        .waitForFunction(() => {
          const status = document
            .querySelector('[data-asterveil-homework]')
            .shadowRoot.querySelector('.status');
          return status.hasAttribute('data-error') ? status.textContent : false;
        })
        .then(async (handle) => {
          throw new Error(await handle.jsonValue());
        }),
    ]);
    const output = resolve(out, `${edition}.png`);
    await download.saveAs(output);
    const pixels = await page.evaluate(
      async (data) => {
        const img = new Image();
        img.src = data;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
        let red = 0;
        let blue = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i] > 250 && rgba[i + 1] < 5 && rgba[i + 2] < 5) red++;
          if (rgba[i] < 5 && rgba[i + 1] < 5 && rgba[i + 2] > 250) blue++;
        }
        return { width: img.width, height: img.height, red, blue };
      },
      `data:image/png;base64,${(await readFile(output)).toString('base64')}`,
    );
    assert.equal(pixels.width, 1600);
    assert.ok(pixels.height > 2000);
    assert.ok(
      pixels.red > 245000 && pixels.blue > 245000,
      'The exported PNG must contain all eight images',
    );
    assert.ok(backgroundReads > 0, 'The real extension worker fetched the image');
    assert.equal(await editor.inputValue(), document);
    const requests = await worker.evaluate(() => globalThis.permissionRequests);
    assert.deepEqual([...requests[1].origins].sort(), [...initialHosts].sort());
    assert.deepEqual(requests[2].origins, ['https://destination.example.net/*']);
    assert.equal(
      backgroundUrls.has('https://cors.example.net/photo.png'),
      false,
      'CORS-readable image needs no permission',
    );
    for (const url of [
      imageUrl,
      ...extraImages.slice(0, 4),
      'https://destination.example.net/photo.png',
    ])
      assert.ok(backgroundUrls.has(url), `${url} must be handled by the general background path`);
    assert.equal(await page.locator('.export-stage').count(), 0);
    assert.equal(await page.locator('.status').textContent(), '');
    assert.equal(await retry.isVisible(), false);

    await page.getByRole('button', { name: '提交答案', exact: true }).click();
    const confirm = page.getByRole('button', { name: '确认提交', exact: true });
    await confirm.waitFor({ state: 'visible' });
    assert.ok(
      await page.locator('.submission-preview img').evaluate((img) => img.naturalWidth > 0),
    );
    await page.getByRole('button', { name: '返回编辑', exact: true }).click();
    if (edition === 'Asterveil Pro') {
      await page.getByLabel('更多导出选项', { exact: true }).click();
      const pdfPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
      const pdf = await pdfPromise;
      await pdf.saveAs(resolve(out, `${edition}.pdf`));
      assert.equal(
        (await readFile(resolve(out, `${edition}.pdf`))).subarray(0, 5).toString(),
        '%PDF-',
      );
    }

    failImage = true;
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-asterveil-homework]')
        .shadowRoot.querySelector('.status')
        .textContent.includes('HTTP 404'),
    );
    assert.equal(await page.locator('.export-stage').count(), 0);
    assert.equal(await editor.evaluate((el) => el.readOnly), false);
    assert.equal(
      await page.getByRole('button', { name: '导出图片', exact: true }).isEnabled(),
      true,
    );
    failImage = false;
    await worker.evaluate(() =>
      chrome.permissions.remove({ origins: ['https://images.openai.com/*'] }),
    );
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await retry.waitFor({ state: 'visible' });
    await editor.fill('![允许跨域的图片](https://cors.example.net/photo.png)');
    assert.equal(await retry.isVisible(), false, 'Editing clears the stale permission retry');
    const readsBeforeCors = backgroundReads;
    const corsDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await corsDownload;
    assert.equal(
      backgroundReads,
      readsBeforeCors,
      'CORS images export directly without background privileges',
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${edition}: multiple HTTP(S) sources, SVG, CORS, relative/data images, scoped real permissions, denial/retry, CDN redirect, embedded pixels, formulas, submission preview, error recovery${edition === 'Asterveil Pro' ? ', PDF' : ''}.`,
    );
  } finally {
    await context.close();
  }
}
