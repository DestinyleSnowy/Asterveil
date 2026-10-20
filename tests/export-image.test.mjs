import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function compile(path, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, URL, AbortSignal, btoa, ...globals },
  );
  return exports;
}
const shared = compile('../src/shared/export-image.ts');
const url = 'https://images.openai.com/static-rsc-4/example?purpose=inline';
const service = (fetch) =>
  compile('../src/background/export-image.ts', {
    fetch,
    require: () => shared,
  }).fetchExportImage;

test('export image requests accept arbitrary HTTP(S) sources without embedded credentials', async () => {
  for (const valid of [
    url,
    'https://cdn.example.net/picture.svg',
    'http://images.example.org:8080/a.png',
    'https://127.0.0.1/a.jpg',
  ])
    assert.equal(
      shared.isExportImageRequest({ channel: 'asterveil:export-image', url: valid }),
      true,
    );
  for (const invalid of [
    null,
    '',
    'https://images.openai.com@evil.test/image.png',
    'https://user:password@images.openai.com/image.png',
    'file:///image.png',
    'data:image/png;base64,AA==',
    `${url}${'x'.repeat(8192)}`,
  ]) {
    assert.equal(
      shared.isExportImageRequest({ channel: 'asterveil:export-image', url: invalid }),
      false,
    );
    await assert.rejects(
      service(() => assert.fail('must not fetch an unapproved origin'))(invalid),
      /不支持/,
    );
  }
  assert.equal(shared.isExportImageRequest({ channel: 'asterveil', url }), false);
});

test('image fetch requires the specific origin permission before making requests', async () => {
  const result = await service(() => assert.fail('must not fetch before permission'))(
    'https://other.example:8080/a.png?secret=123',
    async (origin) => {
      assert.equal(origin, 'https://other.example/*');
      return false;
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.permissionUrl, 'https://other.example:8080/a.png?secret=123');
  assert.equal(
    shared.isExportImageAccessRequest({ channel: 'asterveil:export-image-access', urls: [url] }),
    true,
  );
  for (const urls of [[], ['file:///secret'], ['https://*/*'], [null], Array(201).fill(url)])
    assert.equal(
      shared.isExportImageAccessRequest({ channel: 'asterveil:export-image-access', urls }),
      false,
    );
});

test('image fetch omits credentials/referrer, supports redirects and encodes the exact bytes', async () => {
  const bytes = new Uint8Array([0, 255, 137, 80, 78, 71]);
  const result = await service(async (input, options) => {
    assert.equal(input, url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'follow');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 2));
          controller.enqueue(bytes.slice(2));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'image/PNG; charset=binary' } },
    );
  })(url, async () => true);
  assert.equal(result.ok, true);
  assert.equal(result.dataUrl, `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
});

test('failed, empty and non-image responses never become exported image data', async () => {
  for (const [response, message] of [
    [new Response('missing', { status: 404 }), /HTTP 404/],
    [new Response('<html/>', { headers: { 'content-type': 'text/html' } }), /格式/],
    [new Response('', { headers: { 'content-type': 'image/jpeg' } }), /内容为空/],
  ])
    await assert.rejects(
      service(async () => response)(url, async () => true),
      message,
    );
  await assert.rejects(
    service(async () => {
      throw new TypeError('fetch failed');
    })(url, async () => true),
    /检查链接或网络/,
  );
});

test('declared and streamed oversized images are cancelled before encoding', async () => {
  for (const declared of [false, true]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(declared ? 1 : shared.maxExportImageBytes + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = { 'content-type': 'image/png' };
    if (declared) headers['content-length'] = String(shared.maxExportImageBytes + 1);
    await assert.rejects(
      service(async () => new Response(body, { headers }))(url, async () => true),
      /10 MB/,
    );
    assert.equal(cancelled, true);
  }
});

test('generic CDN binary responses are identified by image bytes, not URL suffixes', async () => {
  for (const [signature, type] of [
    ['\x89PNG\r\n\x1a\n', 'png'],
    ['\xff\xd8\xff', 'jpeg'],
    ['GIF89a', 'gif'],
    ['RIFF1234WEBP', 'webp'],
    ['BM', 'bmp'],
    ['\x00\x00\x01\x00', 'x-icon'],
    ['1234ftypavif', 'avif'],
  ]) {
    const result = await shared.imageResponseData(
      new Response(Buffer.from(signature, 'latin1'), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    assert.ok(result.startsWith(`data:image/${type};base64,`));
  }
});

test('redirect destinations are permission checked, retried without CORS taint and cleaned up', async () => {
  const target = 'https://cdn.example.net/image';
  for (const allowed of [false, true]) {
    const fetched = [];
    const stopped = [];
    let redirect;
    const result = await service(async (input) => {
      fetched.push(input);
      if (input === url) {
        redirect(target);
        throw new TypeError('CORS redirect');
      }
      return new Response('image', { headers: { 'content-type': 'image/png' } });
    })(
      url,
      async (origin) => origin === shared.imagePermissionOrigin(url) || allowed,
      async (input, callback) => {
        redirect = callback;
        return () => stopped.push(input);
      },
    );
    assert.deepEqual(fetched, allowed ? [url, target] : [url]);
    assert.deepEqual(stopped, fetched);
    assert.equal(result.ok, allowed);
    if (!allowed) assert.equal(result.permissionUrl, target);
  }
});

test('redirect loops and unsupported destinations fail without unbounded fetches', async () => {
  for (const target of [url, 'file:///secret']) {
    let redirect;
    let fetched = 0;
    await assert.rejects(
      service(async () => {
        fetched++;
        redirect(target);
        throw new TypeError('redirect');
      })(
        url,
        async () => true,
        async (_url, callback) => {
          redirect = callback;
          return () => {};
        },
      ),
      /跳转|不支持/,
    );
    assert.equal(fetched, 1);
  }
});

test('redirect observation ignores page traffic and other extension requests', async () => {
  let listener;
  let removed;
  const { observeImageRedirects } = compile('../src/background/image-redirects.ts', {
    require: () => ({
      browser: {
        runtime: { id: 'extension-id' },
        permissions: { contains: async () => true },
        webRequest: {
          onBeforeRedirect: {
            addListener(callback) {
              listener = callback;
            },
            removeListener(callback) {
              removed = callback;
            },
          },
        },
      },
    }),
  });
  const seen = [];
  const stop = await observeImageRedirects(url, (target) => seen.push(target));
  const base = {
    url,
    tabId: -1,
    initiator: 'chrome-extension://extension-id',
    redirectUrl: 'https://cdn.example.net/image',
  };
  listener({ ...base, tabId: 42 });
  listener({ ...base, initiator: 'https://jx.7fa4.cn:8888' });
  listener({ ...base, url: 'https://unrelated.example.net/image' });
  assert.deepEqual(seen, []);
  listener(base);
  assert.deepEqual(seen, [base.redirectUrl]);
  stop();
  assert.equal(removed, listener);
});
