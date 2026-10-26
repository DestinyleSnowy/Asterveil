import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';
import { encryptUserNames } from '../build/encrypt-user-names.mjs';

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
      crypto: webcrypto,
      TextEncoder,
      TextDecoder,
      atob,
      URL,
      require: (name) => load(resolve(dirname(path), `${name}.ts`)),
    },
  );
  return exports;
}
const { decryptUserNames } = load('src/shared/user-name-encryption.ts');
const { officialUserNamePassword } = load('src/site/official-user-name-password.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));
const password = 'fixture-only-e\u0301';
const names = { 1: '测试教练', 2476: '测试空昵称', 900000001: '测试学生' };
const grades = { 1: 'jl', 2476: 'c1', 900000001: 'g1' };

test('the build encryptor interoperates with runtime decryption and authenticates metadata', async () => {
  const encrypted = await encryptUserNames(names, grades, 2026, ` ${password}\n`);
  const second = await encryptUserNames(names, grades, 2026, password);
  assert.notEqual(encrypted.salt, second.salt);
  assert.notEqual(encrypted.iv, second.iv);
  assert.notEqual(encrypted.ciphertext, second.ciphertext);
  assert.ok(!JSON.stringify(encrypted).includes(names['2476']));
  assert.deepEqual(plain(await decryptUserNames(encrypted, password.normalize('NFC'))), [
    ['1', '测试教练', 'jl'],
    ['2476', '测试空昵称', 'c1'],
    ['900000001', '测试学生', 'g1'],
  ]);
  for (const tampered of [
    { ...encrypted, academicYear: 2025 },
    { ...encrypted, records: 2 },
    { ...encrypted, iterations: 1 },
    { ...encrypted, version: 2 },
    { ...encrypted, ciphertext: `A${encrypted.ciphertext.slice(1, -1)}B` },
    { ...encrypted, iv: 'invalid' },
  ])
    await assert.rejects(decryptUserNames(tampered, password), /官方数据无法解锁/);
  await assert.rejects(decryptUserNames(encrypted, 'wrong-password'), /官方数据无法解锁/);
  await assert.rejects(decryptUserNames(encrypted, ''), /官方数据无法解锁/);
});

test('signature parsing reads the designated field and treats a 200 login page as locked', () => {
  const { document } = parseHTML(
    '<h4>个性签名</h4><div class="ui bottom attached segment"><div> fixture-only-é </div></div><h4>其他</h4><div>not-the-key</div>',
  );
  assert.equal(officialUserNamePassword(document), password.normalize('NFC'));
  const parse = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return officialUserNamePassword(template.content);
  };
  assert.throws(() => parse('<div>请登录后查看用户信息</div>'), /请先登录/);
  assert.throws(() => parse('<h4>个性签名</h4><div> </div>'), /未找到解锁口令/);
  assert.throws(() => parse('<h4>其他用户资料</h4><div>not-the-key</div>'), /未找到解锁口令/);
});

test('signature parsing extracts only the initial password while preserving inline formatting', () => {
  const parse = (signature) => {
    const { document } = parseHTML(
      `<h4>个性签名</h4><div class="ui bottom attached segment"><div>${signature}</div></div>`,
    );
    return officialUserNamePassword(document);
  };
  for (const signature of [
    `<p>${password} 是 Better Names 的密码，后面添加说明。</p>`,
    `<p>${password}\t备注</p>`,
    `<p>${password}\n备注</p>`,
    `<p>${password}&nbsp;备注</p>`,
    `<p>${password}<br>备注</p>`,
    `<p>${password}</p><p>第二段说明，无需额外空格。</p>`,
    `<div>${password}</div><div>第二段说明</div>`,
    `<p></p><p> ${password} </p><p>备注</p>`,
    '<p><strong>fixture-</strong><em>only-</em>é<br>备注</p>',
  ])
    assert.equal(parse(signature), password.normalize('NFC'));
  assert.equal(parse(`<p>${password} ${'说明'.repeat(3000)}</p>`), password.normalize('NFC'));
  assert.throws(() => parse(`<p>${'x'.repeat(4097)} 备注</p>`), /未找到解锁口令/);
  assert.throws(() => parse('<p><br></p>'), /未找到解锁口令/);
});
