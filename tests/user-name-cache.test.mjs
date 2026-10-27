import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
function load(path) {
  path = resolve(root, path);
  if (modules.has(path)) return modules.get(path);
  const exports = {};
  modules.set(path, exports);
  runInNewContext(
    ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      URL,
      structuredClone,
      crypto: { randomUUID },
      require: (name) => load(resolve(dirname(path), `${name}.ts`)),
    },
  );
  return exports;
}
const { createUserNameCache } = load('src/background/user-name-cache.ts');
const { isUserNameCacheRequest, isUserNameCacheFresh } = load('src/shared/user-name-cache.ts');
const client = { origin: 'https://jx.7fa4.cn:8888', tabId: 1, documentId: 'first' };
const other = { ...client, tabId: 2, documentId: 'second' };
const connect = (account) => ({
  channel: 'asterveil',
  type: 'user-names.cache',
  action: 'connect',
  account,
});
const save = (token, kind = 'official', name = '示例甲') => ({
  channel: 'asterveil',
  type: 'user-names.cache',
  action: 'save',
  token,
  kind,
  entries: [['1', name, 'g1']],
  ...(kind === 'official' && { password: 'public-test-password' }),
});
function fixture() {
  let stored;
  let reads = 0;
  let fail = false;
  const notices = [];
  const repository = {
    read: async () => {
      reads++;
      return structuredClone(stored);
    },
    write: async (state) => {
      if (fail) {
        fail = false;
        throw new Error('quota');
      }
      stored = structuredClone(state);
    },
  };
  const service = (revision = 'v1') =>
    createUserNameCache(
      repository,
      revision,
      (target, notice) => notices.push({ target, notice }),
      () => 1234,
    );
  return {
    service,
    notices,
    stored: () => stored,
    reads: () => reads,
    fail: () => {
      fail = true;
    },
  };
}

test('source cache messages reject malformed IDs, records, grades and misplaced passwords', () => {
  const valid = save('token');
  assert.equal(isUserNameCacheRequest(valid), true);
  assert.equal(isUserNameCacheRequest(connect(1)), true);
  assert.equal(isUserNameCacheRequest(connect(null)), true);
  for (const value of [
    connect('1'),
    connect(0),
    null,
    {},
    { ...valid, kind: 'unknown' },
    { ...valid, password: undefined },
    { ...valid, kind: 'plan' },
    { ...valid, entries: [['1', '甲', 'g4']] },
    { ...valid, entries: [['0', '甲']] },
    {
      ...valid,
      entries: [
        ['1', '甲'],
        ['1', '乙'],
      ],
    },
    { ...valid, entries: [['1', '甲', 'g1', 'private-phone']] },
    { ...valid, entries: [['1', '换\n行']] },
    { ...valid, entries: new Array(10_001) },
  ])
    assert.equal(isUserNameCacheRequest(value), false);
});

test('session snapshots expire by source and cannot become indefinitely fresh after a clock change', () => {
  assert.equal(isUserNameCacheFresh('official', 0, 29 * 60_000), true);
  assert.equal(isUserNameCacheFresh('official', 0, 30 * 60_000), false);
  for (const kind of ['plan', 'friends']) {
    assert.equal(isUserNameCacheFresh(kind, 0, 4 * 60_000), true);
    assert.equal(isUserNameCacheFresh(kind, 0, 5 * 60_000), false);
    assert.equal(isUserNameCacheFresh(kind, 100, 99), false);
  }
});

test('a session reuses complete records across documents and background worker restarts', async () => {
  const f = fixture();
  let service = f.service();
  const first = await service(connect(1), client);
  await service(save(first.token), client);
  const second = await service(connect(1), other);
  assert.equal(second.token, first.token);
  assert.deepEqual(second.records.official.entries, [['1', '示例甲', 'g1']]);
  assert.equal(second.records.official.savedAt, 1234);
  assert.equal(f.reads(), 1);
  service = f.service();
  const restarted = await service(connect(1), { ...client, documentId: 'third' });
  assert.equal(restarted.token, first.token);
  assert.equal(restarted.records.official.password, 'public-test-password');
  assert.equal(f.reads(), 2);
  assert.equal(f.notices.length, 0, 'the saving document does not notify itself');
});

test('account switches and logout invalidate old tabs and reject late writes or reconnects', async () => {
  const f = fixture();
  const service = f.service();
  const first = await service(connect(1), client);
  await service(save(first.token), client);
  const next = await service(connect(2), other);
  assert.notEqual(next.token, first.token);
  assert.equal(next.records.official, undefined);
  assert.equal(f.notices[0].target.documentId, client.documentId);
  assert.equal(f.notices[0].notice.token, first.token);
  assert.equal((await service(save(first.token), client)).clearCache, true);
  assert.equal((await service(connect(1), client)).clearCache, true);
  await service(save(next.token, 'plan'), other);
  const guest = await service(connect(null), { ...other, documentId: 'logged-out' });
  assert.equal(guest.token, null);
  assert.equal(Object.keys(guest.records).length, 0);
  assert.equal(f.stored().sessions[client.origin], undefined);
  assert.equal((await service(connect(2), other)).clearCache, true);
});

test('a resumed old page cannot revive a discarded login after its document guard is evicted', async () => {
  const f = fixture();
  const service = f.service();
  const old = await service(connect(1), client);
  await service(connect(2), other);
  for (let index = 0; index < 257; index++)
    await service(connect(2), { ...other, documentId: `new-${index}` });
  assert.equal(f.stored().documents[client.documentId], undefined);
  const stale = await service({ ...connect(1), token: old.token }, client);
  assert.equal(stale.clearCache, true);
  assert.equal(f.stored().sessions[client.origin].account, 2);
});

test('refresh results and revocations reach same-account pages without crossing origins', async () => {
  const f = fixture();
  const service = f.service();
  const first = await service(connect(1), client);
  await service(connect(1), other);
  const differentOrigin = {
    ...other,
    origin: 'https://in.7fa4.cn:8888',
    documentId: 'other-origin',
  };
  const isolated = await service(connect(1), differentOrigin);
  assert.notEqual(isolated.token, first.token);
  await service(save(first.token, 'friends'), client);
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].target.documentId, other.documentId);
  assert.equal(f.notices[0].notice.record.entries[0][1], '示例甲');
  await service(
    {
      channel: 'asterveil',
      type: 'user-names.cache',
      action: 'discard',
      kind: 'friends',
      token: first.token,
    },
    client,
  );
  assert.equal(f.notices[1].notice.record, undefined);
  assert.equal((await service(connect(1), other)).records.friends, undefined);
  assert.equal((await service(connect(1), differentOrigin)).records.friends, undefined);
});

test('new roster revisions discard old snapshots and failed writes preserve the previous cache', async () => {
  const f = fixture();
  let service = f.service();
  const first = await service(connect(1), client);
  await service(save(first.token), client);
  f.fail();
  await assert.rejects(service(save(first.token, 'official', '不得保存'), client));
  assert.equal((await service(connect(1), other)).records.official.entries[0][1], '示例甲');
  service = f.service('v2');
  const changed = await service(connect(1), client);
  assert.notEqual(changed.token, first.token);
  assert.equal(changed.records.official, undefined);
});
