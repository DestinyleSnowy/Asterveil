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

test('export image requests accept only the exact HTTPS image origin', async () => {
  assert.equal(shared.isExportImageRequest({ channel: 'asterveil:export-image', url }), true);
  for (const invalid of [
    null,
    '',
    'http://images.openai.com/image.png',
    'https://images.openai.com:8080/image.png',
    'https://images.openai.com.evil.test/image.png',
    'https://images.openai.com@evil.test/image.png',
    'https://user:password@images.openai.com/image.png',
    'file:///image.png',
    'https://127.0.0.1/image.png',
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

test('image fetch omits credentials/referrer, blocks redirects and encodes the exact bytes', async () => {
  const bytes = new Uint8Array([0, 255, 137, 80, 78, 71]);
  const result = await service(async (input, options) => {
    assert.equal(input, url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
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
  })(url);
  assert.equal(result, `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
});

test('failed, empty and non-raster responses never become exported image data', async () => {
  for (const [response, message] of [
    [new Response('missing', { status: 404 }), /HTTP 404/],
    [new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), /格式/],
    [new Response('<html/>', { headers: { 'content-type': 'text/html' } }), /格式/],
    [new Response('', { headers: { 'content-type': 'image/jpeg' } }), /内容为空/],
  ])
    await assert.rejects(service(async () => response)(url), message);
  await assert.rejects(
    service(async () => {
      throw new TypeError('fetch failed');
    })(url),
    /检查网络/,
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
    await assert.rejects(service(async () => new Response(body, { headers }))(url), /10 MB/);
    assert.equal(cancelled, true);
  }
});
