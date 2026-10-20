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
    let failImage = false;
    let backgroundReads = 0;
    await context.route('https://images.openai.com/**', (route) => {
      if (route.request().serviceWorker()) backgroundReads++;
      // Prevent the routing helper from adding permissive CORS headers:
      // allow a different origin so <img> works while page fetch fails.
      return route.fulfill(
        failImage
          ? { status: 404, contentType: 'text/plain', body: 'missing' }
          : {
              contentType: 'image/png',
              headers: { 'access-control-allow-origin': 'https://unrelated.invalid' },
              body: Buffer.from(png.split(',')[1], 'base64'),
            },
      );
    });
    await context.route('https://jx.7fa4.cn:8888/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><style>body{margin:20px;font-family:system-ui}</style><div class="ui main container"><h1>H1 导出检查</h1><form id="submit_code" method="post" action="/problem/1/submit"><div><input type="file" name="answer"></div></form></div>',
      }),
    );
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: resolve('.output', edition) });
    await page.goto('https://jx.7fa4.cn:8888/problem/1');
    const editor = page.getByRole('textbox', { name: 'Markdown', exact: true });
    await editor.fill(sample);
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

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const download = await downloadPromise;
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
    assert.ok(pixels.red > 20000 && pixels.blue > 20000, 'The exported PNG must contain the image');
    assert.ok(backgroundReads > 0, 'The real extension worker fetched the image');
    assert.equal(await editor.inputValue(), sample);
    assert.equal(await page.locator('.export-stage').count(), 0);
    assert.equal(await page.locator('.status').textContent(), '');

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
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${edition}: actual extension, CORS reproduction, embedded PNG pixels, formulas, draft preservation, submission preview, error recovery${edition === 'Asterveil Pro' ? ', PDF' : ''}.`,
    );
  } finally {
    await context.close();
  }
}
