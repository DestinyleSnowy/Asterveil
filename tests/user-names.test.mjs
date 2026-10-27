import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const base = new URL('https://jx.7fa4.cn:8888/');
const names = new Map([
  ['1', '示例甲'],
  ['2', '示例乙'],
]);
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
      {
        exports,
        URL,
        AbortController,
        console,
        ...globals,
        require(name) {
          if (name === './edition') return { editorName: 'Markdown Editor', pdfEnabled: false };
          return name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : require(name);
        },
      },
    );
    return exports;
  }
  return load;
}
function fixture(html) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  const frames = new Map();
  let sequence = 0;
  const load = loader({
    document,
    Element: window.Element,
    HTMLAnchorElement: window.HTMLAnchorElement,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: window.MutationObserver,
    requestAnimationFrame(callback) {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  const scope = new (load('src/core/scope.ts').Scope)();
  const module = load('src/site/user-names.ts');
  return {
    document,
    scope,
    load,
    frames,
    mount: (database = names) => module.replaceUserNames(scope, base, database),
    frameCount: () => sequence,
    async settle() {
      for (let round = 0; round < 8; round++) {
        await setImmediate();
        if (!frames.size) return;
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback();
      }
      assert.fail('Name mapping must settle without an observer loop');
    },
  };
}

test('the encrypted database shares a pinned source and enables the module without resetting preferences', () => {
  const database = JSON.parse(
    readFileSync(resolve(root, 'src/data/user-names.encrypted.json'), 'utf8'),
  );
  const source = JSON.parse(readFileSync(resolve(root, 'src/data/user-names.source.json'), 'utf8'));
  assert.equal(database.records, source.records);
  assert.ok(source.records > 3000);
  assert.equal(database.records, source.gradeRecords);
  assert.equal(source.sourceAcademicYear, 2025);
  assert.equal(source.academicYear, 2026);
  assert.equal(database.academicYear, source.academicYear);
  assert.equal(database.algorithm, 'AES-GCM');
  assert.equal(database.kdf, 'PBKDF2-SHA256');
  assert.equal(Buffer.from(database.salt, 'base64').length, 16);
  assert.equal(Buffer.from(database.iv, 'base64').length, 12);
  assert.ok(Buffer.from(database.ciphertext, 'base64').length > 100_000);
  assert.match(source.revision, /^[a-f\d]{40}$/);
  const load = loader();
  const { defaultSettings, decodeSettings } = load('src/shared/settings.ts');
  const old = JSON.parse(JSON.stringify(defaultSettings()));
  delete old.modules['user-names'];
  old.modules['local-avatars'] = false;
  old.accentColor = '#bd4476';
  const settings = decodeSettings(old);
  assert.equal(settings.modules['user-names'], true);
  assert.equal(settings.modules['local-avatars'], false);
  assert.equal(settings.accentColor, '#bd4476');
  assert.equal(
    decodeSettings({ ...settings, modules: { ...settings.modules, 'user-names': false } }).modules[
      'user-names'
    ],
    false,
  );
});

test('the grade palette preserves cohort labels and returns the exact saved colors', () => {
  const palette = loader()('src/shared/user-name-palette.ts');
  const defaults = palette.defaultUserGradePalette();
  assert.equal(palette.userGradeDefinitions.length, 16);
  assert.equal(palette.userGradeLabel('g1'), '高2026级');
  assert.equal(palette.userGradeColor('c1', defaults), '#ff4d4f');
  assert.equal(palette.userGradeColor('clear', defaults), undefined);
  for (const { key, color } of palette.userGradeDefinitions)
    assert.equal(palette.userGradeColor(key, defaults), color);
  const classic = { ...defaults, mode: 'classic' };
  for (const [key, color] of [
    ['x4', '#5e6e5e'],
    ['x5', '#8c8c8c'],
    ['x6', '#722ed1'],
    ['c1', '#9254de'],
    ['c2', '#ff4d4f'],
    ['c3', '#fa8c16'],
    ['g1', '#faad14'],
    ['g2', '#ca00ca'],
    ['g3', '#52c41a'],
    ['d1', '#13c2c2'],
    ['d2', '#9254de'],
    ['d3', '#597ef7'],
    ['d4', '#73d13d'],
    ['by', '#8c8c8c'],
    ['jl', '#ff85c0'],
    ['uk', '#5e6e5e'],
  ])
    assert.equal(
      palette.userGradeColor(key, classic),
      color,
      `${palette.userGradeLabel(key)} keeps its original classic color`,
    );
  for (const [before, after, color] of [
    ['小2020级', '初2026级', '#9254de'],
    ['初2023级', '高2026级', '#faad14'],
    ['高2023级', '大2026级', '#13c2c2'],
  ]) {
    const grade = palette.normalizeUserGrade(before);
    assert.equal(palette.userGradeLabel(grade), after);
    assert.equal(palette.userGradeColor(grade, classic), color);
  }
  for (const color of ['#000000', '#ffffff', '#70dbff', '#96cc00'])
    assert.equal(
      palette.userGradeColor('g1', { mode: 'custom', colors: { ...defaults.colors, g1: color } }),
      color,
    );
});

test('the 2026 snapshot promotes every school stage and preserves status grades', () => {
  const load = loader();
  const year = load('src/shared/user-grade-year.ts');
  const palette = load('src/shared/user-name-palette.ts');
  for (const [, from, to] of [
    ['2198', 'x4', 'x5'],
    ['1597', 'x5', 'x6'],
    ['1337', 'x6', 'c1'],
    ['901', 'c1', 'c2'],
    ['679', 'c2', 'c3'],
    ['140', 'c3', 'g1'],
    ['130', 'g1', 'g2'],
    ['11', 'g2', 'g3'],
    ['4', 'g3', 'd1'],
    ['5', 'd1', 'd2'],
    ['78', 'd2', 'd3'],
    ['86', 'd3', 'd4'],
    ['6', 'd4', 'by'],
    ['1', 'jl', 'jl'],
    ['2', 'uk', 'uk'],
    ['8', 'by', 'by'],
  ]) {
    assert.equal(year.advanceUserGrade(from, 2025), to);
    assert.equal(year.advanceUserGrade(to, 2026), to, 'current-year data must not advance twice');
  }
  assert.equal(year.advanceUserGrade('clear', 2025), 'clear');
  assert.equal(year.advanceUserGrade('c2', 2024), 'g1');
  for (const input of [null, '2025', 1999, 2027])
    assert.throws(() => year.advanceUserGrade('g1', input));
  for (const [label, grade] of [
    ['小2020级', 'c1'],
    ['初2023级', 'g1'],
    ['高2023级', 'd1'],
    ['大2022级', 'by'],
    ['初2025级', 'c2'],
    ['高2025级', 'g2'],
  ])
    assert.equal(palette.normalizeUserGrade(label), grade);
  assert.equal(palette.userGradeLabel('x4'), '小2023级');
  assert.equal(palette.userGradeLabel('d1'), '大2026级');
  assert.throws(() => palette.normalizeUserGrade('初2027级'));
});

test('untouched legacy default palettes adopt the current colors while custom colors remain intact', () => {
  const palette = loader()('src/shared/user-name-palette.ts');
  const legacyClassic = [
    '#8c8c8c',
    '#722ed1',
    '#9254de',
    '#ff4d4f',
    '#fa8c16',
    '#faad14',
    '#ca00ca',
    '#52c41a',
    '#13c2c2',
    '#9254de',
    '#597ef7',
    '#73d13d',
    '#bfbfbf',
    '#8c8c8c',
    '#ff85c0',
    '#5e6e5e',
  ];
  const legacyColors = Object.fromEntries(
    palette.userGradeDefinitions.map(({ key }, index) => [key, legacyClassic[index]]),
  );
  assert.equal(
    palette.decodeUserGradePalette({ mode: 'default', colors: legacyColors }).colors.g1,
    '#96cc00',
  );
  assert.equal(
    palette.decodeUserGradePalette({ mode: 'custom', colors: legacyColors }).colors.g1,
    '#ca00ca',
  );
  const oldColors = [
    '#8b6da8',
    '#785b97',
    '#654b83',
    '#4f80ad',
    '#3f6e9b',
    '#315c87',
    '#428775',
    '#327462',
    '#266150',
    '#ac804e',
    '#9b6e40',
    '#895d36',
    '#774f30',
    '#7b8594',
    '#ad637d',
    '#687584',
  ];
  const colors = Object.fromEntries(
    palette.userGradeDefinitions.map(({ key }, index) => [key, oldColors[index]]),
  );
  assert.equal(palette.decodeUserGradePalette({ mode: 'default', colors }).colors.g1, '#96cc00');
  assert.equal(palette.decodeUserGradePalette({ mode: 'custom', colors }).colors.g1, '#428775');
  const edited = { ...colors, g1: '#112233' };
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(palette.decodeUserGradePalette({ mode: 'default', colors: edited }).colors),
    ),
    edited,
  );
});

test('only exact profile URLs on the two supported origins identify a person', () => {
  const { profileUserId } = loader()('src/site/user-names.ts');
  for (const href of ['/user/1', '/user/1/?from=list#bio', 'https://in.7fa4.cn:8888/user/1'])
    assert.equal(profileUserId(href, base), '1');
  for (const href of [
    '/user/1/friend',
    '/review/user_tag/edit?user_id=1',
    '/submissions?submitter=1',
    'https://example.com/user/1',
    'https://jx.7fa4.cn.evil.example:8888/user/1',
    'https://jx.7fa4.cn/user/1',
    'http://jx.7fa4.cn:8888/user/1',
    'https://name@jx.7fa4.cn:8888/user/1',
    '/user/0',
    '/user/9007199254740992',
    'javascript:alert(1)',
    '',
  ])
    assert.equal(profileUserId(href, base), undefined, href);
});

test('mapping preserves images, badges, markup and click handlers, skips controls and editable text, and restores original labels', async () => {
  const f = fixture(`
    <a id="plain" href="/user/1" title="原提示" aria-label="account">account</a>
    <a id="rich" href="/user/2" style="color: purple"><img src="avatar.png"><b>old_</b><span>nick</span><span class="badge">老师</span></a>
    <a id="unknown" href="/user/99">unknown</a>
    <a id="external" href="https://example.com/user/1">external</a>
    <a id="action" class="ui button" href="/user/1">查看主页</a>
    <a id="review" href="/review/user_tag/edit?user_id=1">看复盘</a>
    <a id="avatar" href="/user/1"><img src="only.png"></a>
    <a id="literal" href="/user/1">/user/1</a>
    <div id="user-dropdown"><a href="/user/1">当前用户</a></div>
    <pre><a href="/user/1">code</a></pre>
    <div contenteditable="true"><a href="/user/1">editable</a></div>
    <input value="account"><textarea>account</textarea>
  `);
  const before = f.document.body.innerHTML;
  const plain = f.document.querySelector('#plain');
  const rich = f.document.querySelector('#rich');
  const children = [...rich.children];
  let clicked = 0;
  rich.addEventListener('click', () => clicked++);
  f.mount();
  await f.settle();
  assert.equal(plain.textContent, '示例甲');
  assert.equal(plain.getAttribute('title'), '原提示\n原用户名：account');
  assert.equal(plain.getAttribute('aria-description'), '原用户名：account');
  assert.equal(plain.getAttribute('aria-label'), '示例甲');
  assert.equal(rich.textContent, '示例乙老师');
  assert.deepEqual([...rich.children], children);
  assert.equal(rich.getAttribute('style'), 'color: purple');
  rich.click();
  assert.equal(clicked, 1);
  for (const [id, text] of [
    ['unknown', 'unknown'],
    ['external', 'external'],
    ['action', '查看主页'],
    ['review', '看复盘'],
    ['literal', '/user/1'],
  ])
    assert.equal(f.document.querySelector(`#${id}`).textContent, text);
  assert.equal(f.document.querySelector('#avatar').textContent, '');
  assert.equal(f.document.querySelector('pre a').textContent, 'code');
  assert.equal(f.document.querySelector('[contenteditable] a').textContent, 'editable');
  assert.equal(f.document.querySelector('#user-dropdown a').textContent, '当前用户');
  f.scope.dispose();
  assert.equal(f.document.body.innerHTML, before);
  assert.equal(f.frames.size, 0);
});

test('AJAX additions, reused URLs and server edits remain reversible while score changes cause no name scan', async () => {
  const f = fixture('<div id="list"><a href="/user/1">first</a></div><span id="score">0</span>');
  f.mount();
  await f.settle();
  const added = f.document.createElement('a');
  added.setAttribute('href', '/user/2');
  added.textContent = 'second';
  f.document.querySelector('#list').append(added);
  await f.settle();
  assert.equal(added.textContent, '示例乙');
  added.textContent = 'server_new';
  await f.settle();
  assert.equal(added.textContent, '示例乙');
  assert.equal(added.getAttribute('title'), '原用户名：server_new');
  added.setAttribute('href', '/user/1');
  await f.settle();
  assert.equal(added.textContent, '示例甲');
  added.setAttribute('href', '/user/99');
  await f.settle();
  assert.equal(added.textContent, 'server_new');
  assert.equal(added.hasAttribute('title'), false);
  const frames = f.frameCount();
  for (let index = 0; index < 300; index++)
    f.document.querySelector('#score').textContent = String(index);
  await f.settle();
  assert.equal(f.frameCount(), frames);
  const first = f.document.querySelector('#list a');
  first.textContent = 'site owns this';
  first.setAttribute('title', 'site title');
  f.scope.dispose();
  await f.settle();
  assert.equal(first.textContent, 'site owns this');
  assert.equal(first.getAttribute('title'), 'site title');
  assert.equal(added.textContent, 'server_new');
});

test('empty nicknames in name cells display names while standalone avatars and paired avatar links stay intact', async () => {
  const f = fixture(`<table><tbody>
    <tr><td class="td name"><a id="blank" href="/user/1">\n<img src="avatar.png">\n\t</a></td></tr>
    <tr><td class="name"><a id="empty" href="/user/2"></a></td></tr>
    <tr><td class="name"><a id="pair-avatar" href="/user/1"><img src="pair.png"></a> <a id="pair-name" href="/user/1"> </a></td></tr>
    <tr><td class="name"><a id="known-avatar" href="/user/1"><img src="known.png"></a> <a id="known-name" href="/user/1">account</a></td></tr>
    <tr><td class="name"><a id="badge-name" href="/user/2"><img src="badge.png"><span class="badge">老师</span></a></td></tr>
    <tr><td class="name"><a id="unknown-empty" href="/user/99"><img src="unknown.png"></a></td></tr>
  </tbody></table><a id="standalone" href="/user/1">\n<img src="only.png">\n</a>`);
  const before = f.document.body.innerHTML;
  const blank = f.document.querySelector('#blank');
  const avatar = blank.querySelector('img');
  let clicks = 0;
  blank.addEventListener('click', () => clicks++);
  f.mount();
  await f.settle();
  assert.equal(blank.textContent.trim(), '示例甲');
  assert.equal(blank.getAttribute('title'), '原用户名为空');
  assert.equal(blank.querySelector('img'), avatar);
  assert.equal(f.document.querySelector('#empty').textContent, '示例乙');
  assert.equal(f.document.querySelector('#pair-name').textContent.trim(), '示例甲');
  assert.equal(f.document.querySelector('#pair-avatar').textContent, '');
  assert.equal(f.document.querySelector('#known-avatar').textContent, '');
  assert.equal(f.document.querySelector('#known-name').textContent, '示例甲');
  assert.equal(f.document.querySelector('#standalone').textContent.trim(), '');
  assert.equal(f.document.querySelector('#unknown-empty').textContent, '');
  const badgeName = f.document.querySelector('#badge-name');
  assert.equal(badgeName.childNodes[1].textContent.trim(), '示例乙');
  assert.equal(badgeName.querySelector('.badge').textContent, '老师');
  blank.click();
  assert.equal(clicks, 1);
  f.scope.dispose();
  assert.equal(f.document.body.innerHTML, before);
});

test('inserted names follow reused URLs and yield to native nickname updates without leaving duplicate text', async () => {
  const f = fixture(
    '<table><tr><td class="name"><a href="/user/1"><img src="avatar.png"></a></td></tr></table>',
  );
  const link = f.document.querySelector('a');
  const avatar = link.querySelector('img');
  f.mount();
  await f.settle();
  link.setAttribute('href', '/user/2');
  await f.settle();
  assert.equal(link.textContent.trim(), '示例乙');
  assert.equal(link.childNodes.length, 2);
  link.setAttribute('href', '/user/99');
  await f.settle();
  assert.equal(link.textContent, '');
  assert.equal(link.childNodes.length, 1);
  link.setAttribute('href', '/user/1');
  await f.settle();
  link.append(f.document.createTextNode('native_nickname'));
  await f.settle();
  assert.equal(link.textContent, '示例甲');
  assert.equal(link.childNodes.length, 2);
  assert.equal(link.getAttribute('title'), '原用户名：native_nickname');
  assert.equal(link.querySelector('img'), avatar);
  f.scope.dispose();
  assert.equal(link.textContent, 'native_nickname');
  assert.equal(link.childNodes.length, 2);
  assert.equal(link.hasAttribute('title'), false);
});

test('database names are always rendered as text', async () => {
  const f = fixture('<a href="/user/1">account</a>');
  const label = '<img src=x onerror=alert(1)>';
  f.mount(new Map([['1', label]]));
  await f.settle();
  const link = f.document.querySelector('a');
  assert.equal(link.textContent, label);
  assert.equal(link.children.length, 0);
  f.scope.dispose();
  assert.equal(link.textContent, 'account');
});
