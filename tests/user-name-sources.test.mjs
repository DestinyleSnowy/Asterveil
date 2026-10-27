import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    {
      exports,
      console,
      URL,
      AbortController,
      crypto: { randomUUID },
      require(name) {
        if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
        return load(resolve(dirname(path), `${name}.ts`));
      },
    },
  );
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const model = load('src/shared/user-name-sources.ts');
const palette = load('src/shared/user-name-palette.ts');
const { defaultSettings, decodeSettings } = load('src/shared/settings.ts');
const { createSettingsService } = load('src/background/settings-service.ts');
const { isSettingsRequest } = load('src/shared/protocol.ts');
const official = new Map([['1', '示例甲']]);
const command = (text, name = '自定义') => ({ type: 'settings.user-names.import', name, text });
function repository({ fail = false } = {}) {
  let stored = defaultSettings();
  let writes = 0;
  let rejectWrite = fail;
  const service = createSettingsService(
    {
      read: async () => decodeSettings(plain(stored)),
      write: async (next) => {
        if (rejectWrite) {
          rejectWrite = false;
          throw new Error('storage full');
        }
        stored = next;
        writes++;
      },
    },
    official,
  );
  return { service, state: () => stored, writes: () => writes };
}

test('source formats preserve duplicate IDs and normalize IDs and names consistently', () => {
  for (const text of [
    '{"1":"示例甲","2":"示例乙"}',
    '\uFEFF{"1":{"name":"示例甲"},"2":{"name":"示例乙"}}',
    '{"users":{"1":{"name":"示例甲"},"2":{"name":"示例乙"}},"version":1}',
    '[{"id":1,"name":"示例甲"},{"user_id":"002","uid":2,"name":" 示例乙 "}]',
  ])
    assert.deepEqual(plain(model.parseUserNameSource(text)), [
      ['1', '示例甲'],
      ['2', '示例乙'],
    ]);
  for (const text of [
    '{"1":"示例甲","1":"示例甲"}',
    '{"\\u0031":"示例甲","01":"示例甲"}',
    '[{"id":1,"name":"示例甲"},{"id":"001","name":"示例甲"}]',
  ])
    assert.deepEqual(plain(model.parseUserNameSource(text)), [['1', '示例甲']]);
  assert.deepEqual(plain(model.parseUserNameSource('{"1":"é","01":"e\\u0301"}')), [['1', 'é']]);
  assert.equal(model.parseUserNameSource('{"1":"同名","2":"同名"}').length, 2);
});

test('inconsistent duplicates are rejected within objects, records, wrappers and arrays', () => {
  for (const text of [
    '{"1":"甲","1":"乙"}',
    '{"\\u0031":"甲","1":"乙"}',
    '{"01":"甲","1":"乙"}',
    '{"1":{"name":"甲"},"1":{"name":"乙"}}',
    '{"users":{"1":"甲"},"users":{"1":"乙"}}',
    '[{"id":1,"name":"甲"},{"uid":1,"name":"乙"}]',
    '{"1":"Alice","1":"alice"}',
  ])
    assert.throws(() => model.parseUserNameSource(text), /ID 1/);
  assert.throws(() => model.parseUserNameSource('{"1":{"name":"甲","name":"乙"}}'), /name 不一致/);
  assert.throws(() => model.parseUserNameSource('[{"id":1,"uid":2,"name":"甲"}]'), /ID 不一致/);
  assert.throws(() => model.parseUserNameSource('{"1":{"id":2,"name":"甲"}}'), /ID 不一致/);
  assert.throws(() => model.parseUserNameSource('{"users":{"1":"甲"},"1":"乙"}'), /不能混合/);
});

test('malformed, empty, oversized and unsafe source data fails before import', () => {
  for (const text of [
    '',
    '{}',
    '[]',
    'null',
    '1',
    '{"1":"甲",}',
    '// comment\n{}',
    '{"1":"甲"}{}',
    '{"1":"\\q"}',
    '{"1":""}',
    '{"0":"甲"}',
    '{"-1":"甲"}',
    '{"9007199254740993":"甲"}',
    '{"__proto__":{"name":"甲"}}',
    '[{"id":true,"name":"甲"}]',
    '[{"id":1}]',
    '[{"name":"甲"}]',
    '{"1":"line\\nname"}',
    '{"1":{"name":42}}',
    `${'['.repeat(20)}0${']'.repeat(20)}`,
    ' '.repeat(model.maxUserNameImportLength + 1),
  ])
    assert.throws(() => model.parseUserNameSource(text));
  assert.throws(() => model.parseUserNameSource(JSON.stringify({ 1: '甲'.repeat(129) })));
  assert.throws(
    () =>
      model.parseUserNameSource(
        JSON.stringify(
          Object.fromEntries(
            Array.from({ length: 10001 }, (_, index) => [String(index + 1), '甲']),
          ),
        ),
      ),
    /10,000/,
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test('old settings gain an empty source list and stored source data is validated', () => {
  const old = plain(defaultSettings());
  delete old.userNames;
  old.modules['user-names'] = false;
  assert.deepEqual(plain(decodeSettings(old).userNames), plain(model.defaultUserNameSources()));
  assert.equal(decodeSettings(old).modules['user-names'], false);
  const source = { id: randomUUID(), name: '自定义', entries: [['99', '甲']] };
  for (const value of [
    null,
    {},
    { revision: -1, sources: [] },
    { revision: 0, sources: {} },
    { revision: 0, sources: [{ ...source, id: 'official' }] },
    { revision: 0, sources: [source, source] },
    {
      revision: 0,
      sources: [
        {
          ...source,
          entries: [
            ['99', '甲'],
            ['99', '乙'],
          ],
        },
      ],
    },
    { revision: 0, sources: [source, { ...source, id: randomUUID(), entries: [['99', '乙']] }] },
  ])
    assert.throws(() => decodeSettings({ ...old, userNames: value }));
});

test('source selection migrates old settings, preserves explicit switches and rejects malformed values', () => {
  const legacy = {
    revision: 4,
    academicYear: 2026,
    sources: [{ id: randomUUID(), name: '旧名单', entries: [['99', '甲', 'g1']] }],
  };
  const migrated = model.decodeUserNameSources(legacy);
  assert.deepEqual(plain(migrated.builtin), { official: true, plan: true, friends: true });
  assert.equal(migrated.sources[0].enabled, true);
  const stored = {
    ...plain(migrated),
    builtin: { official: false, plan: false, friends: true },
    sources: [{ ...plain(migrated.sources[0]), enabled: false }],
  };
  assert.deepEqual(plain(model.decodeUserNameSources(stored)), stored);
  for (const builtin of [null, [], false, { official: 0 }, { friends: 'false' }])
    assert.throws(() => model.decodeUserNameSources({ ...legacy, builtin }));
  assert.throws(() =>
    model.decodeUserNameSources({
      ...legacy,
      sources: [{ ...legacy.sources[0], enabled: 'false' }],
    }),
  );
});

test('each source can be independently selected while imports still check disabled local sources', () => {
  let state = model.importUserNameSource(
    model.defaultUserNameSources(),
    '名单',
    '{"99":"甲"}',
    official,
  );
  const id = state.sources[0].id;
  state = model.setUserNameSourceEnabled(state, id, false, official);
  assert.equal(model.activeUserNameRecords(official, state).has('99'), false);
  assert.equal(model.activeUserNameRecords(official, state).get('1').name, '示例甲');
  state = model.setUserNameSourceEnabled(state, 'official', false, official);
  assert.equal(model.activeUserNameRecords(official, state).size, 0);
  assert.throws(() => model.importUserNameSource(state, '冲突', '{"99":"乙"}', official), /冲突/);
  assert.throws(() => model.importUserNameSource(state, '冲突', '{"1":"乙"}', official), /冲突/);
  assert.equal(model.importUserNameSource(state, '同一名单', '{"99":"甲"}', official), state);
  assert.equal(state.sources[0].enabled, false);
  state = model.setUserNameSourceEnabled(state, id, true, official);
  assert.deepEqual(plain([...model.activeUserNameRecords(official, state)]), [
    ['99', { name: '甲' }],
  ]);
  assert.equal(model.setUserNameSourceEnabled(state, id, true, official), state);
  assert.throws(
    () => model.setUserNameSourceEnabled(state, randomUUID(), true, official),
    /不存在/,
  );
});

test('source selections serialize with imports and unrelated settings without overwrites', async () => {
  const repo = repository();
  await Promise.all([
    repo.service({ type: 'settings.user-names.source', id: 'official', enabled: false }),
    repo.service(command('{"99":"甲"}')),
    repo.service({ type: 'settings.user-names.source', id: 'friends', enabled: false }),
    repo.service({ type: 'settings.accent', color: '#123456' }),
  ]);
  let state = repo.state();
  assert.equal(state.accentColor, '#123456');
  assert.deepEqual(plain(state.userNames.builtin), { official: false, plan: true, friends: false });
  const id = state.userNames.sources[0].id;
  await repo.service({ type: 'settings.user-names.source', id, enabled: false });
  const before = repo.writes();
  await repo.service({ type: 'settings.user-names.source', id, enabled: false });
  assert.equal(repo.writes(), before);
  state = repo.state();
  assert.equal(model.activeUserNameRecords(official, state.userNames).size, 0);
  assert.equal(state.userNames.sources[0].entries[0][1], '甲');
  await assert.rejects(
    repo.service({ type: 'settings.user-names.source', id: randomUUID(), enabled: true }),
  );
  assert.equal(repo.writes(), before);
  for (const id of ['official', 'plan', 'friends', state.userNames.sources[0].id])
    assert.equal(
      isSettingsRequest({
        channel: 'asterveil',
        type: 'settings.user-names.source',
        id,
        enabled: false,
      }),
      true,
    );
  for (const [id, enabled] of [
    ['invalid', true],
    ['official', 'false'],
    ['friends', undefined],
  ])
    assert.equal(
      isSettingsRequest({ channel: 'asterveil', type: 'settings.user-names.source', id, enabled }),
      false,
    );
});

test('grade codes, cohort labels and original Better Names records normalize without losing metadata', () => {
  for (const text of [
    '{"1":{"name":"甲","colorKey":"g1"},"2":{"name":"乙","grade":"初2026级"}}',
    '{"users":{"1":{"name":"甲","colorKey":"g1","grade":"高2026级"},"2":{"name":"乙","grade":"c1"}}}',
    '[{"id":1,"name":"甲","grade":"g1"},{"uid":2,"name":"乙","colorKey":"c1"}]',
    '{"1":"甲","01":{"name":"甲","colorKey":"g1"},"2":{"name":"乙","grade":"c1"}}',
  ])
    assert.deepEqual(plain(model.parseUserNameSource(text)), [
      ['1', '甲', 'g1'],
      ['2', '乙', 'c1'],
    ]);
  assert.deepEqual(plain(model.parseUserNameSource('{"1":{"name":"甲","colorKey":"clear"}}')), [
    ['1', '甲', 'clear'],
  ]);
  for (const text of [
    '{"1":{"name":"甲","colorKey":"g1","grade":"g2"}}',
    '{"1":{"name":"甲","colorKey":"g1","colorKey":"g2"}}',
    '{"1":{"name":"甲","grade":"g1"},"01":{"name":"甲","grade":"g2"}}',
    '{"1":{"name":"甲","colorKey":"unknown"}}',
    '{"1":{"name":"甲","grade":123}}',
  ])
    assert.throws(() => model.parseUserNameSource(text));
});

test('stored and imported historical grades upgrade once before checking official conflicts', () => {
  const old = {
    revision: 3,
    sources: [
      {
        id: randomUUID(),
        name: '旧名单',
        entries: [
          ['1', '示例甲', 'c3'],
          ['99', '甲', 'x6'],
          ['100', '乙', 'd4'],
        ],
      },
    ],
    palette: palette.defaultUserGradePalette(),
  };
  const decoded = model.decodeUserNameSources(old);
  assert.equal(decoded.academicYear, 2026);
  assert.equal(decoded.revision, 4);
  assert.deepEqual(plain(decoded.sources[0].entries), [
    ['1', '示例甲', 'g1'],
    ['99', '甲', 'c1'],
    ['100', '乙', 'by'],
  ]);
  assert.deepEqual(plain(model.decodeUserNameSources(plain(decoded))), plain(decoded));
  assert.equal(
    model.mergedUserRecords(official, decoded.sources, new Map([['1', 'g1']])).get('1').grade,
    'g1',
  );
  assert.deepEqual(
    plain(
      model.parseUserNameSource(
        '{"academicYear":2025,"users":{"1":{"name":"甲","colorKey":"c3","grade":"初2023级"},"2":{"name":"乙","colorKey":"x6"}}}',
      ),
    ),
    [
      ['1', '甲', 'g1'],
      ['2', '乙', 'c1'],
    ],
  );
  assert.deepEqual(
    plain(
      model.parseUserNameSource(
        '{"academicYear":2026,"users":{"1":{"name":"甲","colorKey":"g1"}}}',
      ),
    ),
    [['1', '甲', 'g1']],
  );
  for (const value of [null, '2025', 1999, 2027]) {
    assert.throws(() => model.decodeUserNameSources({ ...old, academicYear: value }));
    assert.throws(() =>
      model.parseUserNameSource(
        JSON.stringify({ academicYear: value, users: { 1: { name: '甲', grade: 'g1' } } }),
      ),
    );
  }
  assert.throws(() =>
    model.parseUserNameSource('{"academicYear":2025,"academicYear":2026,"users":{"1":"甲"}}'),
  );
});

test('grade conflicts reject whole imports; unspecified grades inherit without changing official metadata', async () => {
  const grades = new Map([['1', 'g1']]);
  let state = model.defaultUserNameSources();
  state = model.importUserNameSource(
    state,
    '姓名名单',
    '{"1":"示例甲","99":"甲"}',
    official,
    grades,
  );
  state = model.importUserNameSource(
    state,
    '年级名单',
    '{"99":{"name":"甲","colorKey":"c1"}}',
    official,
    grades,
  );
  let merged = model.mergedUserRecords(official, state.sources, grades);
  assert.equal(merged.get('1').grade, 'g1');
  assert.equal(merged.get('99').grade, 'c1');
  const before = plain(state);
  for (const text of [
    '{"100":"不能写入","1":{"name":"示例甲","grade":"g2"}}',
    '{"100":"不能写入","99":{"name":"甲","grade":"c2"}}',
    '{"99":{"name":"甲","grade":"clear"}}',
  ]) {
    assert.throws(
      () => model.importUserNameSource(state, '冲突', text, official, grades),
      /年级冲突/,
    );
    assert.deepEqual(plain(state), before);
  }
  const gradeSource = state.sources[1];
  state = model.removeUserNameSource(state, gradeSource.id);
  merged = model.mergedUserRecords(official, state.sources, grades);
  assert.equal(merged.get('99').grade, undefined);
  assert.equal(merged.get('1').grade, 'g1');

  let stored = defaultSettings();
  let writes = 0;
  const service = createSettingsService(
    {
      read: async () => decodeSettings(plain(stored)),
      write: async (next) => {
        stored = next;
        writes++;
      },
    },
    official,
    grades,
  );
  const results = await Promise.allSettled([
    service(command('{"99":{"name":"甲","grade":"g1"}}', 'A')),
    service(command('{"100":"不能写入","99":{"name":"甲","grade":"g2"}}', 'B')),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(writes, 1);
  assert.equal(stored.userNames.sources.length, 1);
  assert.equal(model.mergedUserNames(official, stored.userNames.sources).has('100'), false);
});

test('palette edits, mode changes and reset persist without overwriting imported sources', async () => {
  const repo = repository();
  await repo.service(command('{"99":{"name":"甲","grade":"g1"}}'));
  const sources = plain(repo.state().userNames.sources);
  await repo.service({ type: 'settings.user-names.palette.color', grade: 'g1', color: '#AABBCC' });
  assert.equal(repo.state().userNames.palette.mode, 'custom');
  assert.equal(repo.state().userNames.palette.colors.g1, '#aabbcc');
  await repo.service({ type: 'settings.user-names.palette.mode', mode: 'default' });
  assert.equal(palette.userGradeColor('g1', repo.state().userNames.palette), '#96cc00');
  const classic = { type: 'settings.user-names.palette.mode', mode: 'classic' };
  assert.equal(isSettingsRequest({ channel: 'asterveil', ...classic }), true);
  await repo.service(classic);
  const restored = decodeSettings(plain(repo.state()));
  assert.equal(restored.userNames.palette.mode, 'classic');
  assert.equal(palette.userGradeColor('g1', restored.userNames.palette), '#faad14');
  assert.equal(palette.userGradeColor('g2', restored.userNames.palette), '#ca00ca');
  assert.equal(palette.userGradeColor('clear', restored.userNames.palette), undefined);
  assert.equal(restored.userNames.palette.colors.g1, '#aabbcc');
  assert.deepEqual(plain(restored.userNames.sources), sources);
  await repo.service({ type: 'settings.user-names.palette.mode', mode: 'custom' });
  assert.equal(palette.userGradeColor('g1', repo.state().userNames.palette), '#aabbcc');
  const writes = repo.writes();
  await repo.service({ type: 'settings.user-names.palette.mode', mode: 'custom' });
  assert.equal(repo.writes(), writes);
  await repo.service(command('{"100":"乙"}'));
  assert.equal(repo.state().userNames.palette.colors.g1, '#aabbcc');
  await repo.service({
    type: 'settings.user-names.remove',
    id: repo.state().userNames.sources[1].id,
  });
  assert.equal(repo.state().userNames.palette.colors.g1, '#aabbcc');
  await repo.service(classic);
  await repo.service({ type: 'settings.user-names.palette.reset' });
  assert.deepEqual(plain(repo.state().userNames.palette), plain(palette.defaultUserGradePalette()));
  assert.deepEqual(plain(repo.state().userNames.sources), sources);
  for (const value of [
    { type: 'settings.user-names.palette.color', grade: 'g4', color: '#aabbcc' },
    { type: 'settings.user-names.palette.color', grade: 'g1', color: 'red' },
    { type: 'settings.user-names.palette.mode', mode: 'unknown' },
  ])
    assert.equal(isSettingsRequest({ channel: 'asterveil', ...value }), false);
  for (const value of [
    { mode: 'unknown', colors: {} },
    { mode: 'custom', colors: { g1: 'red' } },
    { mode: 'custom', colors: { invalid: '#000000' } },
  ]) {
    assert.throws(() =>
      decodeSettings({
        ...plain(repo.state()),
        userNames: { ...plain(repo.state().userNames), palette: value },
      }),
    );
  }
});

test('official and existing sources accept identical overlaps and reject mismatches atomically', async () => {
  const repo = repository();
  await repo.service(command('{"1":"示例甲","99":"甲"}'));
  await repo.service(command('{"99":"甲","100":"乙"}', '另一个'));
  assert.equal(repo.state().userNames.sources.length, 2);
  assert.deepEqual(plain([...model.mergedUserNames(official, repo.state().userNames.sources)]), [
    ['1', '示例甲'],
    ['99', '甲'],
    ['100', '乙'],
  ]);
  for (const text of [
    '{"101":"新","1":"冲突"}',
    '{"101":"新","99":"冲突"}',
    '{"101":"新","101":"另一个"}',
  ]) {
    const before = plain(repo.state());
    const writes = repo.writes();
    await assert.rejects(repo.service(command(text)), /冲突|不一致/);
    assert.deepEqual(plain(repo.state()), before);
    assert.equal(repo.writes(), writes);
  }
  await repo.service(command('{"102":"后续导入"}'));
  assert.equal(
    repo.state().userNames.sources.length,
    3,
    'a rejected import must not poison the queue',
  );
});

test('same-content imports are idempotent; removing a source preserves overlapping names', async () => {
  const repo = repository();
  await repo.service(command('{"99":"甲","100":"乙"}'));
  const first = repo.state().userNames.sources[0];
  await repo.service(command('[{"id":100,"name":"乙"},{"id":99,"name":"甲"}]', '同一数据'));
  assert.equal(repo.writes(), 1);
  await repo.service(command('{"99":"甲","101":"丙"}'));
  assert.equal(new Set(repo.state().userNames.sources.map((source) => source.name)).size, 2);
  await assert.rejects(repo.service({ type: 'settings.user-names.remove', id: 'official' }));
  await repo.service({ type: 'settings.user-names.remove', id: first.id });
  const merged = model.mergedUserNames(official, repo.state().userNames.sources);
  assert.equal(merged.get('99'), '甲');
  assert.equal(merged.has('100'), false);
  assert.equal(merged.get('1'), '示例甲');
  const writes = repo.writes();
  await repo.service({ type: 'settings.user-names.remove', id: first.id });
  assert.equal(repo.writes(), writes);
});

test('concurrent conflicting imports use the latest stored sources and unrelated settings are preserved', async () => {
  const repo = repository();
  const results = await Promise.allSettled([
    repo.service(command('{"99":"甲"}', 'A')),
    repo.service(command('{"99":"乙"}', 'B')),
    repo.service({ type: 'settings.accent', color: '#bd4476' }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
  assert.equal(repo.state().userNames.sources.length, 1);
  assert.equal(repo.state().userNames.sources[0].entries[0][1], '甲');
  assert.equal(repo.state().userNames.revision, 1);
  assert.equal(repo.state().revision, 2);
  assert.equal(repo.state().accentColor, '#bd4476');
});

test('failed persistence leaves the previous state intact and imports remain retryable', async () => {
  const repo = repository({ fail: true });
  const before = plain(repo.state());
  await assert.rejects(repo.service(command('{"99":"甲"}')), /storage full/);
  assert.deepEqual(plain(repo.state()), before);
  await repo.service(command('{"99":"甲"}'));
  assert.equal(repo.state().userNames.sources.length, 1);
});

test('encrypted official validation is required before writing and its password is never persisted', async () => {
  let stored = defaultSettings();
  let writes = 0;
  const service = createSettingsService(
    {
      read: async () => decodeSettings(plain(stored)),
      write: async (next) => {
        stored = next;
        writes++;
      },
    },
    async (request) => {
      if (request.officialPassword !== 'fixture-only-password') throw new Error('官方数据无法解锁');
      return { names: official, grades: new Map([['1', 'jl']]) };
    },
  );
  await assert.rejects(service(command('{"99":"新增"}')), /官方数据无法解锁/);
  assert.equal(writes, 0);
  await service({ ...command('{"99":"新增"}'), officialPassword: 'fixture-only-password' });
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(stored).includes('fixture-only-password'), false);
  await service({ type: 'settings.user-names.source', id: 'official', enabled: false });
  const before = plain(stored);
  await assert.rejects(
    service({
      ...command('{"1":"错误覆盖"}'),
      officialPassword: 'fixture-only-password',
    }),
    /冲突/,
  );
  assert.deepEqual(plain(stored), before);
  await service({ type: 'settings.accent', color: '#abcdef' });
  assert.equal(stored.accentColor, '#abcdef');
  for (const value of [42, null, 'a'.repeat(4097)])
    assert.equal(
      isSettingsRequest({
        channel: 'asterveil',
        ...command('{"99":"新增"}'),
        officialPassword: value,
      }),
      false,
    );
});

test('source count and message limits are enforced without blocking harmless reimports', async () => {
  const repo = repository();
  for (let index = 0; index < model.maxUserNameSources; index++)
    await repo.service(command(JSON.stringify({ [100 + index]: '甲' })));
  await repo.service(command('{"100":"甲"}'));
  assert.equal(repo.state().userNames.sources.length, model.maxUserNameSources);
  await assert.rejects(repo.service(command('{"200":"甲"}')), /10 个/);
  assert.equal(isSettingsRequest({ channel: 'asterveil', ...command('{"99":"甲"}') }), true);
  for (const value of [
    command('{}', ''),
    command('{}', 'x'.repeat(81)),
    command('x'.repeat(model.maxUserNameImportLength + 1)),
    { type: 'settings.user-names.remove', id: 'official' },
  ])
    assert.equal(isSettingsRequest({ channel: 'asterveil', ...value }), false);
});
