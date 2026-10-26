import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
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
    { exports, AbortController, require: (name) => load(resolve(dirname(path), `${name}.ts`)) },
  );
  return exports;
}
const model = load('src/shared/better-names-plan.ts');
const year = load('src/shared/user-grade-year.ts');
const names = load('src/shared/user-name-sources.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('high-school graduation years resolve across all school stages in the maintained academic year', () => {
  for (const [value, grade] of [
    [2035, 'x4'],
    [2034, 'x5'],
    [2033, 'x6'],
    [2032, 'c1'],
    [2031, 'c2'],
    [2030, 'c3'],
    [2029, 'g1'],
    [2028, 'g2'],
    [2027, 'g3'],
    [2026, 'd1'],
    [2025, 'd2'],
    [2024, 'd3'],
    [2023, 'd4'],
    [2022, 'by'],
    [2000, 'by'],
    ['2029', 'g1'],
  ])
    assert.equal(year.graduateYearUserGrade(value), grade);
  for (const value of [undefined, null, '', false, '202x', 2029.5, 0, 10000, 2036])
    assert.equal(year.graduateYearUserGrade(value), 'uk');
});

test('plan parsing keeps only ID, real name and grade, and rejects unusable or ambiguous entries', () => {
  const users = [
    {
      id: '001',
      uid: 'nickname',
      real_name: ' 示例甲 ',
      graduate_year: 2029,
      phone: 'private-phone',
      email: 'private-email',
    },
    { id: 1, real_name: '示例甲', graduate_year: '2029' },
    { id: 2, real_name: '示例乙', graduate_year: null },
    { id: 3, real_name: '不一致甲', graduate_year: 2029 },
    { id: 3, real_name: '不一致乙', graduate_year: 2029 },
    { id: 3, real_name: '不一致甲', graduate_year: 2029 },
    { id: 4, real_name: '年级冲突', graduate_year: 2029 },
    { id: 4, real_name: '年级冲突', graduate_year: 2028 },
    { uid: '5', real_name: '昵称不是数字 ID', graduate_year: 2029 },
    { id: 0, real_name: '无效 ID' },
    { id: true, real_name: '无效 ID' },
    { id: '9007199254740993', real_name: '无效 ID' },
    { id: 6, real_name: '' },
    { id: 7, real_name: '换\n行' },
    { id: 8, real_name: '甲'.repeat(129) },
    { id: 9, real_name: '<img src=x onerror=alert(1)>', graduate_year: 2026 },
  ];
  const entries = model.parseBetterNamesPlan({ success: true, users });
  assert.deepEqual(plain(entries), [
    ['1', '示例甲', 'g1'],
    ['2', '示例乙', 'uk'],
    ['9', '<img src=x onerror=alert(1)>', 'd1'],
  ]);
  assert.equal(JSON.stringify(entries).includes('private'), false);
  assert.deepEqual(plain(model.parseBetterNamesPlan(users)), plain(entries));
  assert.deepEqual(plain(model.parseBetterNamesPlan({ users: [] })), []);
  for (const value of [
    null,
    '<html>login</html>',
    {},
    { users: {} },
    { success: false, users },
    { users: new Array(10001) },
  ])
    assert.throws(() => model.parseBetterNamesPlan(value));
});

test('official special cases and custom records override the entire plan record without a conflict error', () => {
  const database = new Map([
    ['1', { name: '特别教练', grade: 'jl' }],
    ['2', { name: '不改配色', grade: 'clear' }],
    ['3', { name: '原库无年级' }],
    ['4', { name: '其他人员', grade: 'uk' }],
  ]);
  const plan = model.parseBetterNamesPlan({
    users: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      real_name: '计划姓名',
      graduate_year: 2029,
    })),
  });
  const merged = model.supplementUserRecords(database, plan);
  for (const [id, record] of database) assert.equal(merged.get(id), record);
  assert.deepEqual(plain(merged.get('5')), { name: '计划姓名', grade: 'g1' });
  assert.equal(database.has('5'), false);
  assert.throws(
    () =>
      names.mergedUserRecords(new Map([['1', '特别教练']]), [
        { name: '自定义', entries: [['1', '不同姓名']] },
      ]),
    /冲突/,
  );
});

test('requests deduplicate, identical updates reuse records, and failed refreshes retain valid cached data', async () => {
  let calls = 0;
  let failure;
  let incoming = [['1', '示例甲', 'g1']];
  const source = model.createBetterNamesPlanSource(
    async () => {
      calls++;
      if (failure) throw failure;
      return incoming;
    },
    () => 'origin:1',
  );
  let state;
  const stop = source.subscribe((value) => {
    state = value;
  });
  const first = source.refresh();
  assert.equal(source.refresh(true), first);
  await first;
  assert.equal(calls, 1);
  const records = state.entries;
  await source.refresh();
  assert.equal(calls, 1);
  incoming = plain(incoming);
  await source.refresh(true);
  assert.equal(state.entries, records);
  failure = new Error('server details must not be displayed');
  await source.refresh(true);
  assert.equal(state.entries, records);
  assert.equal(state.loaded, true);
  assert.equal(state.error, '暂时无法更新');
  failure = new model.BetterNamesPlanError('暂无访问权限', true);
  await source.refresh(true);
  assert.equal(state.loaded, false);
  assert.equal(state.entries.length, 0);
  assert.equal(state.error, '暂无访问权限');
  const before = calls;
  await source.refresh();
  assert.equal(calls, before, 'an automatic remount must not loop on access failures');
  failure = undefined;
  await source.refresh(true);
  assert.equal(state.error, '');
  assert.equal(state.loaded, true);
  stop();
});

test('account changes clear cached data and discard late responses from the previous account', async () => {
  let account = 'origin:1';
  const requests = [];
  const source = model.createBetterNamesPlanSource(
    (signal) => new Promise((resolve) => requests.push({ resolve, signal })),
    () => account,
  );
  let state;
  const stop = source.subscribe((value) => {
    state = value;
  });
  const old = source.refresh();
  await Promise.resolve();
  account = 'origin:2';
  assert.equal(source.checkContext(), true);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(state.entries.length, 0);
  const current = source.refresh();
  await Promise.resolve();
  requests[0].resolve([['1', '旧账号名单', 'g1']]);
  await old;
  assert.equal(state.entries.length, 0);
  assert.equal(state.loading, true);
  requests[1].resolve([['2', '新账号名单', 'c1']]);
  await current;
  assert.equal(state.entries[0][1], '新账号名单');
  account = 'other-origin:2';
  source.checkContext();
  assert.equal(state.entries.length, 0);
  const cancelled = source.refresh();
  stop();
  await cancelled;
  assert.equal(requests.length, 2, 'a released page must not start a queued request');
});

test('disabling a remote source aborts requests even with a settings subscriber and ignores late responses', async () => {
  const requests = [];
  const source = model.createBetterNamesPlanSource(
    (signal) => new Promise((resolve) => requests.push({ resolve, signal })),
    () => 'origin:1',
  );
  let state;
  const stop = source.subscribe((value) => {
    state = value;
  });
  const initial = source.refresh();
  await Promise.resolve();
  requests[0].resolve([['1', '缓存名单', 'g1']]);
  await initial;
  const entries = state.entries;
  const pending = source.refresh(true);
  await Promise.resolve();
  source.cancel();
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(state.loading, false);
  assert.equal(state.entries, entries);
  requests[1].resolve([['2', '已关闭源的迟到名单', 'c1']]);
  await pending;
  assert.equal(state.entries, entries);
  await source.refresh();
  assert.equal(requests.length, 2, 'reenabling can reuse valid cached entries');
  stop();
});
