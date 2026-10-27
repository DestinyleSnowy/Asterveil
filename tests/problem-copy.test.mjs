import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as marked from 'marked';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
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
      crypto: { randomUUID },
      require(name) {
        if (name === 'marked') return marked;
        if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
        return load(resolve(dirname(path), `${name}.ts`));
      },
    },
  );
  return exports;
}
const { problemDescription } = load('src/site/problem-description.ts');
const { defaultSettings, decodeSettings } = load('src/shared/settings.ts');
const { isSettingsRequest } = load('src/shared/protocol.ts');
const { createSettingsService } = load('src/background/settings-service.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('description copying excludes surrounding sections and preserves code, formulas and subheadings', () => {
  const description = [
    '计算 $a+b$。',
    '',
    '```markdown',
    '## 输入格式',
    '这是描述中的代码，不能截断。',
    '```',
    '',
    '### 补充说明',
    '',
    '$$a+b=c$$',
    '',
    '[参考][ref]',
    '',
    '[ref]: https://example.com/problem',
  ].join('\n');
  const source = `# 题目名称\n\n背景信息\n\n## 题目描述\n\n${description}\n\n## 输入格式\n不应复制\n\n## 输出格式\n不应复制`;
  assert.equal(problemDescription(source), description);
  assert.equal(problemDescription(source.replaceAll('\n', '\r\n')), description);
  assert.equal(problemDescription(`## 题目描述\n\n${description}`), description);
  assert.equal(problemDescription('## 题目描述\n内容\n# 后续大标题\n不应复制'), '内容');
});

test('description headings accept Markdown variants without mistaking fenced code for headings', () => {
  for (const heading of [
    '## **题目描述**',
    '## 问题描述',
    '## 【题目描述】',
    '## Description',
    '## Problem Description',
    '题目描述\n---',
  ])
    assert.equal(
      problemDescription(`前言\n\n${heading}\n\n描述内容\n\n## 输入格式\n不应复制`),
      '描述内容',
    );
  for (const source of [
    '只有输入格式，没有描述章节。',
    '```md\n## 题目描述\n```',
    '## 题目描述\n\n## 输入格式\n输入内容',
    '',
  ])
    assert.equal(problemDescription(source), undefined);
});

test('legacy settings gain copy preferences and malformed option messages cannot overwrite them', () => {
  const old = plain(defaultSettings());
  delete old.problemCopy;
  delete old.modules['problem-copy'];
  old.modules.homework = false;
  old.accentColor = '#112233';
  const decoded = decodeSettings(old);
  assert.deepEqual(plain(decoded.problemCopy), {
    source: true,
    description: true,
    hideOriginal: false,
  });
  assert.equal(decoded.modules['problem-copy'], true);
  assert.equal(decoded.modules.homework, false);
  assert.equal(decoded.accentColor, '#112233');
  for (const problemCopy of [null, [], false, { source: 'yes' }, { hideOriginal: 1 }])
    assert.throws(() => decodeSettings({ ...old, problemCopy }), /复制题面设置无效/);
  for (const request of [
    { option: 'unknown', enabled: true },
    { option: 'source', enabled: 'true' },
    { enabled: true },
  ])
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.problem-copy', ...request }),
      false,
    );
});

test('copy options serialize with module and theme changes while preserving unrelated settings', async () => {
  let stored = defaultSettings();
  const service = createSettingsService(
    {
      read: async () => decodeSettings(plain(stored)),
      write: async (next) => {
        stored = next;
      },
    },
    new Map(),
  );
  const names = plain(stored.userNames);
  await Promise.all([
    service({ type: 'settings.problem-copy', option: 'source', enabled: false }),
    service({ type: 'settings.problem-copy', option: 'description', enabled: false }),
    service({ type: 'settings.problem-copy', option: 'hideOriginal', enabled: true }),
    service({ type: 'settings.module', moduleId: 'ui-polish', enabled: false }),
    service({ type: 'settings.accent', color: '#abcdef' }),
  ]);
  assert.deepEqual(plain(stored.problemCopy), {
    source: false,
    description: false,
    hideOriginal: true,
  });
  assert.equal(stored.modules['problem-copy'], true);
  assert.equal(stored.modules['ui-polish'], false);
  assert.equal(stored.accentColor, '#abcdef');
  assert.deepEqual(plain(stored.userNames), names);
  await service({ type: 'settings.module', moduleId: 'problem-copy', enabled: false });
  assert.equal(stored.problemCopy.hideOriginal, true);
});
