import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const board = (
  id,
  count,
) => `<div class="padding"><h1>榜单 ${id}</h1><table class="ui table"><tbody id="tbody-${id}">
  <tr id="title-${id}"><td>排序</td><td>昵称</td><td><a href="?sort=school_oifc">学校</a></td><td><a href="?sort=grade_then">时年</a></td><td>分数</td><td></td><td></td><td></td></tr>
  ${Array.from({ length: count }, (_, i) => `<tr id="line-${id}-${i}"><td>${i + 1}</td><td><a href="/user/${i}">用户 ${i}</a></td><td>${i % 2 ? '甲校' : '乙校'}</td><td>${i % 3 ? '高一' : '高二'}</td><td><a href="/submission/${i}">${600 - i}</a></td><td></td><td></td><td></td></tr>`).join('')}
  </tbody></table></div>`;

function fixture(html = board(0, 600)) {
  const { document, window } = parseHTML(
    `<html><head></head><body><div class="ui main container">${html}</div></body></html>`,
  );
  // linkedom does not implement the native HTML table/select convenience APIs.
  Object.getPrototypeOf(document.createElement('div').style).getPropertyPriority = () => '';
  Object.defineProperties(window.HTMLElement.prototype, {
    cells: {
      configurable: true,
      get() {
        return this.querySelectorAll(':scope > td, :scope > th');
      },
    },
    rows: {
      configurable: true,
      get() {
        return this.querySelectorAll('tr');
      },
    },
    cellIndex: {
      configurable: true,
      get() {
        return Array.from(this.parentElement.children).indexOf(this);
      },
    },
  });
  const frames = new Map();
  let sequence = 0;
  const cache = new Map();
  // Native mutation targets are essential here: linkedom incorrectly reports
  // the observed root as the target for every subtree change.
  const observers = new Set();
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.target = target;
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  }
  const mutate = (target) => {
    for (const observer of observers) {
      if (observer.target === target || observer.target.contains(target)) {
        observer.callback([{ target, type: 'childList', addedNodes: [], removedNodes: [] }]);
      }
    }
  };
  const load = (path) => {
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
        document,
        console,
        URL,
        AbortController,
        Element: window.Element,
        HTMLInputElement: window.HTMLInputElement,
        MutationObserver,
        requestAnimationFrame(fn) {
          frames.set(++sequence, fn);
          return sequence;
        },
        cancelAnimationFrame(id) {
          frames.delete(id);
        },
        require(name) {
          if (name.endsWith('?inline')) return { default: '' };
          return load(resolve(dirname(path), `${name}.ts`));
        },
      },
    );
    return exports;
  };
  const { Scope } = load('src/core/scope.ts');
  const scope = new Scope();
  load('src/site/ranking-filters.ts').enhanceRankingFilters(
    scope,
    new URL('https://jx.7fa4.cn:8888/progress/quiz'),
  );
  const flush = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!frames.size) return;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((fn) => {
        fn();
      });
    }
    assert.fail('Mutation observer feedback loop');
  };
  const panels = () => [...document.querySelectorAll('.asterveil-ranking-filters')];
  const rows = () => [...document.querySelectorAll('tr[id^="line-"]')];
  const shown = () => rows().filter((row) => !row.classList.contains('asterveil-ranking-filtered'));
  const check = (value, checked = true, panel = panels()[0]) => {
    const input = [...panel.querySelectorAll('input')].find((input) => input.value === value);
    assert.ok(input, `Missing filter ${value}`);
    input.checked = checked;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  return { document, window, load, scope, flush, frames, panels, rows, shown, check, mutate };
}

test('all 600 users remain on one page; filters OR within groups and AND across groups', async () => {
  const f = fixture();
  await f.flush();
  assert.equal(f.rows().length, 600);
  assert.equal(f.shown().length, 600);
  assert.equal(f.panels()[0].querySelector('select'), null);
  assert.ok(!f.panels()[0].textContent.includes('下一页'));
  const firstRow = f.rows()[0];
  f.check('甲校');
  f.check('高二');
  assert.equal(f.shown().length, 100);
  assert.ok(
    f
      .shown()
      .every((row) => row.cells[2].textContent === '甲校' && row.cells[3].textContent === '高二'),
  );
  f.check('乙校');
  assert.match(f.panels()[0].textContent, /当前显示 200 \/ 600/);
  assert.equal(f.shown().length, 200);
  f.panels()[0].querySelector('button').click();
  assert.equal(f.shown()[0], firstRow);
  assert.equal(f.shown().length, 600);
  assert.equal(f.rows()[0], firstRow);
  f.scope.dispose();
  assert.equal(f.panels().length, 0);
  assert.ok(f.rows().every((row) => !row.className.includes('asterveil-ranking-')));
  assert.equal(f.frames.size, 0);
  assert.equal(f.document.querySelectorAll('colgroup, .asterveil-ranking-table').length, 0);
});

test('score-only updates do not rescan; native reorder and school edits update filters', async () => {
  const f = fixture();
  await f.flush();
  f.check('甲校');
  for (const row of f.rows()) row.cells[4].textContent = '100';
  for (const row of f.rows()) f.mutate(row.cells[4]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.frames.size, 0);
  const body = f.document.querySelector('tbody');
  const title = body.firstElementChild;
  const reversed = f.rows().reverse();
  body.replaceChildren(title, ...reversed);
  f.mutate(body);
  await f.flush();
  assert.equal(f.shown()[0], reversed[0]);
  reversed[0].cells[2].textContent = '新校';
  f.mutate(reversed[0].cells[2]);
  await f.flush();
  assert.ok(f.panels()[0].textContent.includes('新校'));
  assert.ok(!f.shown().includes(reversed[0]));
  f.scope.dispose();
});

test('boards remain independent, empty matches are recoverable, AJAX replacement cleans up', async () => {
  const f = fixture(board(0, 2) + board(1, 3));
  await f.flush();
  assert.equal(f.panels().length, 2);
  f.check('甲校');
  f.check('高二');
  assert.match(f.panels()[0].textContent, /当前显示 0 \/ 2/);
  assert.match(f.panels()[1].textContent, /当前显示 3 \/ 3/);
  f.panels()[0].querySelector('button').click();
  assert.equal(f.shown().length, 5);
  f.document.querySelector('.ui.main.container').innerHTML = board(2, 4);
  f.mutate(f.document.querySelector('.ui.main.container'));
  await f.flush();
  assert.equal(f.panels().length, 1);
  assert.equal(f.shown().length, 4);
  f.scope.dispose();
});

test('table toolbar ignores score/filter mutations and removes width markers on disable', async () => {
  const f = fixture();
  f.load('src/site/account-tables.ts').enhanceAccountTables(f.scope);
  await f.flush();
  assert.equal(f.document.querySelectorAll('.asterveil-wide-table').length, 1);
  f.check('甲校');
  f.rows()[0].cells[4].textContent = '200';
  f.mutate(f.rows()[0].cells[4]);
  f.mutate(f.panels()[0].querySelector('[role="status"]'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.frames.size, 0);
  f.scope.dispose();
  assert.equal(
    f.document.querySelectorAll(
      '.asterveil-wide-table, .asterveil-wide-padding, .asterveil-has-wide-table',
    ).length,
    0,
  );
});

test('automatic scrolling does not limit the full list or change active filters', async () => {
  const f = fixture(`<div id="auto_update"></div>${board(0, 600)}`);
  await f.flush();
  assert.equal(f.shown().length, 600);
  const toggle = f.document.getElementById('auto_update');
  toggle.classList.add('checked');
  f.mutate(toggle);
  assert.equal(f.shown().length, 600);
  f.check('甲校');
  assert.equal(f.shown().length, 300);
  toggle.classList.remove('checked');
  f.mutate(toggle);
  assert.equal(f.shown().length, 300);
  assert.equal(f.panels()[0].querySelector('select'), null);
  f.scope.dispose();
});

test('native export sees every row and its original cells even when filtered', async () => {
  const f = fixture();
  const rows = f.rows();
  const cells = rows.map((row) => [...row.cells]);
  f.check('甲校');
  f.check('高二');
  assert.equal(f.shown().length, 100);
  assert.equal(f.document.querySelectorAll('table tr').length, 601);
  rows.forEach((row, index) => {
    assert.equal(row, f.rows()[index]);
    assert.deepEqual([...row.cells], cells[index]);
    assert.equal(row.cells[1].querySelector('a').getAttribute('href'), `/user/${index}`);
  });
  f.scope.dispose();
  assert.equal(
    f.document.querySelector('table').style.getPropertyValue('--av-ranking-other-columns'),
    '',
  );
});
