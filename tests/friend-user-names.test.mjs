import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
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
      require: (name) => load(resolve(dirname(path), `${name}.ts`)),
    },
  );
  return exports;
}
const { parseFriendUserNames } = load('src/site/friend-user-names.ts');
const { schoolClassUserGrade } = load('src/shared/user-grade-year.ts');
const { supplementUserRecords } = load('src/shared/better-names-plan.ts');
const url = new URL('https://jx.7fa4.cn:8888/user/811/friend');
const plain = (value) => JSON.parse(JSON.stringify(value));
const parse = (html) => plain(parseFriendUserNames(parseHTML(html).document, url));
const headings = ['用户号', '账号', '用户名', '昵称', '姓名', '班级', '座位', '关注关系', ''];
const row = (id, name, grade, href = `/user/${id}`) =>
  `<tr><td><a href="${href}">已被替换的文本</a></td><td>account</td><td>username</td><td>nickname</td><td>${name}</td><td>${grade}</td><td>private-seat</td><td>关注关系</td><td><a href="/user/999/follow">加关注</a></td></tr>`;
const table = (body) =>
  `<table><thead><tr>${headings.map((name) => `<th>${name}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;

test('friend school classes resolve grade prefixes without treating class or seat numbers as cohort years', () => {
  for (const [text, expected] of [
    ['小四3', 'x4'],
    ['小五', 'x5'],
    ['小六3', 'x6'],
    ['小学六年级', 'x6'],
    ['初一7', 'c1'],
    ['初二9', 'c2'],
    ['初三13', 'c3'],
    ['初中1班', 'c1'],
    ['高一贯4', 'g1'],
    ['高二15', 'g2'],
    ['高三3', 'g3'],
    ['高中三年级', 'g3'],
    ['大一1', 'd1'],
    ['大二', 'd2'],
    ['大三', 'd3'],
    ['大四2', 'd4'],
    ['毕业', 'by'],
    ['教练', 'jl'],
    ['老师', 'jl'],
    ['初2023级', 'g1'],
    ['小2020级', 'c1'],
    ['', 'uk'],
    ['15', 'uk'],
    ['小三1', 'uk'],
    ['高四1', 'uk'],
    ['未知', 'uk'],
  ])
    assert.equal(schoolClassUserGrade(text), expected, text);
});

test('friend tables extract only profile ID, real name and class grade from the observed nine-column layout', () => {
  const entries = parse(
    `<table><tr><th>无关表格</th></tr></table>${table(
      row(901, ' 示例甲 ', '高二15') +
        row(902, '示例乙', '初一7') +
        row(903, '大学同学', '大一') +
        row(904, '毕业同学', '毕业') +
        row(905, '', '高一') +
        row(906, '无年级同学', '') +
        row(907, '外部站点', '高一', 'https://example.com/user/907') +
        row(908, '操作链接', '高一', '/user/908/follow'),
    )}`,
  );
  assert.deepEqual(entries, [
    ['901', '示例甲', 'g2'],
    ['902', '示例乙', 'c1'],
    ['903', '大学同学', 'd1'],
    ['904', '毕业同学', 'by'],
    ['906', '无年级同学', 'uk'],
  ]);
  for (const privateValue of ['account', 'username', 'nickname', 'private-seat', 'follow'])
    assert.equal(JSON.stringify(entries).includes(privateValue), false);
  assert.deepEqual(parse(table('')), []);
});

test('friend parsing follows headers, rejects ambiguous duplicates and never falls back to nicknames', () => {
  assert.deepEqual(
    parse(
      '<table><tr><th>姓名</th><th>用户号</th><th>班级</th></tr><tr><td>示例甲</td><td><a href="/user/901">901</a></td><td>高一贯4</td></tr></table>',
    ),
    [['901', '示例甲', 'g1']],
  );
  assert.deepEqual(
    parse(
      table(
        row(901, '甲', '高一') +
          row(901, '甲', '高一') +
          row(902, '乙', '高一') +
          row(902, '丙', '高一') +
          row(902, '乙', '高一') +
          row(903, '丁', '高二') +
          row(903, '丁', '高一') +
          row(904, '', '高一'),
      ),
    ),
    [['901', '甲', 'g1']],
  );
  assert.throws(() => parse('<table><tr><th>用户号</th><th>昵称</th></tr></table>'), /格式/);
  assert.throws(() => parse('<form action="/login"><input type="password"></form>'), /登录/);
  assert.throws(() => parse(table(row(901, '甲', '高一').repeat(10001))), /过大/);
});

test('live friend pages with td headers and no thead are parsed by column labels', () => {
  const header = `<tr>${headings.map((label) => `<td>${label}</td>`).join('')}</tr>`;
  const data = row(901, '示例甲', '高二15') + row(902, '示例乙', '初一7');
  assert.deepEqual(
    parse(
      `<table class="ui celled small very compact data table"><tbody>${header}${data}</tbody></table>`,
    ),
    [
      ['901', '示例甲', 'g2'],
      ['902', '示例乙', 'c1'],
    ],
  );
  assert.deepEqual(parse(`<table>${header}</table>`), []);
  assert.deepEqual(parse(`<table><tr><th colspan="9">关注列表</th></tr>${header}${data}</table>`), [
    ['901', '示例甲', 'g2'],
    ['902', '示例乙', 'c1'],
  ]);
  assert.deepEqual(
    parse(
      '<table><tbody><tr><td>班级</td><th>姓名</th><td>用户号</td></tr><tr><td>高一贯4</td><td>示例丙</td><td><a href="/user/903">903</a></td></tr></tbody></table>',
    ),
    [['903', '示例丙', 'g1']],
  );
  assert.throws(() => parse('<table><tr><td>用户号</td><td>昵称</td></tr></table>'), /格式/);
});

test('friends supplement only IDs absent from selected local and plan sources', () => {
  const local = new Map([['901', { name: '数据库教练', grade: 'jl' }]]);
  const plan = [['902', '计划同学', 'c1']];
  const friends = parse(
    table(
      row(901, '列表姓名', '高一') + row(902, '列表同学', '高三') + row(903, '好友同学', '高二'),
    ),
  );
  const combined = supplementUserRecords(supplementUserRecords(local, plan), friends);
  assert.deepEqual(plain([...combined]), [
    ['901', { name: '数据库教练', grade: 'jl' }],
    ['902', { name: '计划同学', grade: 'c1' }],
    ['903', { name: '好友同学', grade: 'g2' }],
  ]);
});
