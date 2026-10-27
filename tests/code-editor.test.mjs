import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
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
      { exports, URL, ...globals, require: (name) => load(resolve(dirname(path), `${name}.ts`)) },
    );
    return exports;
  }
  return load;
}

test('layout requests are bounded to this extension and the originating top-frame problem document', () => {
  const load = loader();
  const { codeEditorLayoutTarget } = load('src/background/code-editor-layout.ts');
  const { isCodeEditorLayoutRequest } = load('src/shared/code-editor.ts');
  const sender = {
    id: 'extension',
    frameId: 0,
    tab: { id: 7 },
    documentId: 'document',
    url: 'https://jx.7fa4.cn:8888/problem/1',
  };
  for (const url of [sender.url, 'https://in.7fa4.cn:8888/contest/2/problem/1'])
    assert.deepEqual(
      JSON.parse(JSON.stringify(codeEditorLayoutTarget({ ...sender, url }, 'extension'))),
      { tabId: 7, documentIds: ['document'] },
    );
  for (const change of [
    { id: 'other' },
    { frameId: 1 },
    { documentId: undefined },
    { tab: {} },
    { url: 'https://example.com/problem/1' },
    { url: 'https://jx.7fa4.cn:8888/user/1' },
    { url: 'https://jx.7fa4.cn:8888/problem/1/markdown/html' },
    { url: 'invalid' },
  ])
    assert.equal(codeEditorLayoutTarget({ ...sender, ...change }, 'extension'), undefined);
  const request = { channel: 'asterveil', type: 'code-editor.layout', fonts: true };
  assert.equal(isCodeEditorLayoutRequest(request), true);
  assert.equal(isCodeEditorLayoutRequest({ ...request, fonts: false }), true);
  for (const value of [
    null,
    {},
    'code-editor.layout',
    { ...request, fonts: 'true' },
    { ...request, fonts: undefined },
    { ...request, channel: 'page' },
  ])
    assert.equal(isCodeEditorLayoutRequest(value), false);
});

test('the page repair only remeasures and lays out the native submission editor', () => {
  const calls = [];
  const node = {};
  const root = { querySelector: () => node, contains: (candidate) => candidate === node };
  let editorNode = node;
  let present = true;
  const load = loader({
    document: { querySelector: () => (present ? root : null) },
    window: {
      monaco: { editor: { remeasureFonts: () => calls.push('fonts') } },
      editor: { getDomNode: () => editorNode, layout: () => calls.push('layout') },
    },
  });
  const { refreshNativeCodeEditorLayout } = load('src/background/code-editor-layout.ts');
  assert.equal(refreshNativeCodeEditorLayout(true), true);
  assert.deepEqual(calls, ['fonts', 'layout']);
  calls.length = 0;
  assert.equal(refreshNativeCodeEditorLayout(false), true);
  assert.deepEqual(calls, ['layout']);
  calls.length = 0;
  editorNode = {};
  assert.equal(refreshNativeCodeEditorLayout(true), false);
  present = false;
  assert.equal(refreshNativeCodeEditorLayout(true), false);
  assert.deepEqual(calls, []);
});
