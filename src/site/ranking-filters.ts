import { Scope } from '../core/scope';
import css from './ranking-filters.css?inline';

const rowSelector = 'tr[id^="line-"]';
const gradeOrder = [
  '初一',
  '初二',
  '初三',
  '高一',
  '高二',
  '高三',
  '大一',
  '大二',
  '大三',
  '大四',
  '毕业',
];
const filteredClass = 'asterveil-ranking-filtered';

type Dimension = { key: string; label: string; column: number; selected: Set<string> };

function dimensionsFor(header: HTMLTableRowElement, url: URL): Dimension[] {
  const labels: Record<string, string> = {
    school_oifc: '按学校',
    school_short: '按集团校',
    grade_then: '按时年',
    grade: '按现在年级',
  };
  return Array.from(header.cells).flatMap((cell, column) => {
    const href = cell.querySelector('a')?.getAttribute('href');
    if (!href) return [];
    const key = new URL(href, url).searchParams.get('sort') ?? '';
    return labels[key] ? [{ key, label: labels[key], column, selected: new Set<string>() }] : [];
  });
}

function mountBoard(scope: Scope, body: HTMLTableSectionElement, url: URL) {
  const table = body.closest('table');
  const header = body.querySelector<HTMLTableRowElement>('tr[id^="title-"]');
  if (!table || !header) return;
  // Fix column widths so updating a score does not measure every user's cells.
  // Keep all rows connected: the site's updater and XLSX export resolve their IDs.
  const originalWidth = table.style.getPropertyValue('--av-ranking-width');
  const originalPriority = table.style.getPropertyPriority('--av-ranking-width');
  const originalCount = table.style.getPropertyValue('--av-ranking-other-columns');
  const originalCountPriority = table.style.getPropertyPriority('--av-ranking-other-columns');
  const columns = document.createElement('colgroup');
  let width = 0;
  for (let index = 0; index < header.cells.length; index++) {
    const column = document.createElement('col');
    const pixels = index === 0 ? 64 : index === 1 ? 200 : 112;
    column.style.width = `${pixels}px`;
    width += pixels;
    columns.append(column);
  }
  const hasColumns = Boolean(table.querySelector('colgroup'));
  if (!hasColumns) {
    table.prepend(columns);
    table.style.setProperty('--av-ranking-width', `${width}px`);
    table.style.setProperty(
      '--av-ranking-other-columns',
      String(Math.max(1, header.cells.length - 2)),
    );
    table.classList.add('asterveil-ranking-table');
  }
  const dimensions = dimensionsFor(header, url);
  const panel = document.createElement('section');
  panel.className = 'asterveil-ranking-filters';
  panel.setAttribute('aria-label', '榜单筛选');
  const heading = document.createElement('strong');
  heading.textContent = '榜单筛选';
  const summary = document.createElement('div');
  summary.className = 'asterveil-ranking-summary';
  const count = document.createElement('div');
  count.setAttribute('role', 'status');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '清空筛选';
  const top = document.createElement('div');
  top.className = 'asterveil-ranking-heading';
  top.append(heading, reset);
  panel.append(top, summary, count);
  const fields = dimensions.map((dimension) => {
    const field = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = dimension.label;
    const options = document.createElement('div');
    options.className = 'asterveil-ranking-options';
    field.append(legend, options);
    panel.append(field);
    return { dimension, options, inputs: new Map<string, HTMLInputElement>() };
  });
  table.before(panel);

  let rows: HTMLTableRowElement[] = [];
  let frame = 0;
  // Metadata is read once per row, not for every score mutation or filter click.
  let metadata = new WeakMap<HTMLTableRowElement, string[]>();
  const valueAt = (row: HTMLTableRowElement, dimension: Dimension) =>
    row.cells[dimension.column]?.textContent?.trim() || '未填写';
  const setClass = (row: HTMLTableRowElement, name: string, enabled: boolean) => {
    if (row.classList.contains(name) !== enabled) row.classList.toggle(name, enabled);
  };
  const apply = () => {
    let matches = 0;
    for (const row of rows) {
      const values = metadata.get(row) ?? [];
      const keep = dimensions.every(
        (dimension, index) =>
          !dimension.selected.size || dimension.selected.has(values[index] ?? '未填写'),
      );
      setClass(row, filteredClass, !keep);
      if (keep) matches++;
    }
    const selections = dimensions.flatMap((dimension) => [...dimension.selected]);
    summary.textContent = selections.length ? selections.join('、') : '未选择筛选条件，显示全部';
    reset.disabled = selections.length === 0;
    const status = `当前显示 ${matches} / ${rows.length} 人`;
    if (count.textContent !== status) count.textContent = status;
  };
  const sync = () => {
    frame = 0;
    if (scope.signal.aborted) return;
    rows = Array.from(body.querySelectorAll<HTMLTableRowElement>(`:scope > ${rowSelector}`));
    const values = dimensions.map(() => new Set<string>());
    for (const row of rows) {
      let entry = metadata.get(row);
      if (!entry) {
        entry = dimensions.map((dimension) => valueAt(row, dimension));
        metadata.set(row, entry);
      }
      entry.forEach((value, index) => {
        values[index]?.add(value);
      });
    }
    fields.forEach(({ dimension, options, inputs }, index) => {
      const available = values[index];
      if (!available) return;
      // Retain selected absent values during refresh: never silently broaden a filter.
      for (const value of dimension.selected) available.add(value);
      const sorted = [...available].sort((a, b) => {
        if (dimension.key.startsWith('grade')) {
          const rank = (value: string) => {
            const order = gradeOrder.indexOf(value);
            return order < 0 ? gradeOrder.length : order;
          };
          const difference = rank(a) - rank(b);
          if (difference) return difference;
        }
        return a.localeCompare(b, 'zh-CN');
      });
      if (sorted.join('\0') === [...inputs.keys()].join('\0')) return;
      inputs.clear();
      const fragment = document.createDocumentFragment();
      for (const value of sorted) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.checked = dimension.selected.has(value);
        inputs.set(value, input);
        label.append(input, document.createTextNode(value));
        fragment.append(label);
      }
      options.replaceChildren(fragment);
    });
    apply();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  fields.forEach(({ dimension, options }) => {
    options.addEventListener(
      'change',
      (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.checked) dimension.selected.add(input.value);
        else dimension.selected.delete(input.value);
        apply();
      },
      { signal: scope.signal },
    );
  });
  reset.addEventListener(
    'click',
    () => {
      fields.forEach(({ dimension, inputs }) => {
        dimension.selected.clear();
        for (const input of inputs.values()) input.checked = false;
      });
      apply();
    },
    { signal: scope.signal },
  );

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target === body) {
        schedule();
        continue;
      }
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      const cell = element?.closest('td');
      const row = cell?.parentElement as HTMLTableRowElement | null;
      if (
        cell &&
        row?.matches(rowSelector) &&
        dimensions.some((d) => d.column === cell.cellIndex)
      ) {
        metadata.delete(row);
        schedule();
      }
    }
  });
  observer.observe(body, { childList: true, subtree: true, characterData: true });
  sync();
  scope.defer(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const row of rows) row.classList.remove(filteredClass);
    panel.remove();
    if (!hasColumns) {
      columns.remove();
      table.classList.remove('asterveil-ranking-table');
      if (originalWidth)
        table.style.setProperty('--av-ranking-width', originalWidth, originalPriority);
      else table.style.removeProperty('--av-ranking-width');
      if (originalCount)
        table.style.setProperty('--av-ranking-other-columns', originalCount, originalCountPriority);
      else table.style.removeProperty('--av-ranking-other-columns');
    }
    rows = [];
    metadata = new WeakMap();
  });
}

export function enhanceRankingFilters(scope: Scope, url: URL) {
  const main = document.querySelector('.ui.main.container');
  if (!main) return;
  const style = document.createElement('style');
  style.textContent = css;
  document.documentElement.append(style);
  const boards = new Map<HTMLTableSectionElement, Scope>();
  let frame = 0;
  const sync = () => {
    frame = 0;
    for (const [body, child] of boards) {
      if (!main.contains(body)) {
        child.dispose();
        boards.delete(body);
      }
    }
    for (const body of main.querySelectorAll<HTMLTableSectionElement>('tbody[id^="tbody-"]')) {
      if (boards.has(body) || !body.querySelector('tr[id^="title-"]')) continue;
      const child = new Scope();
      boards.set(body, child);
      mountBoard(child, body, url);
    }
  };
  const observer = new MutationObserver((records) => {
    // The site refreshes thousands of cells; only table/container replacement needs discovery.
    if (
      records.some(
        (record) =>
          record.target instanceof Element &&
          (!record.target.closest('table, .asterveil-ranking-filters, .asterveil-table-toolbar') ||
            (record.target.matches('tbody[id^="tbody-"]') &&
              !boards.has(record.target as HTMLTableSectionElement))),
      )
    ) {
      if (!frame) frame = requestAnimationFrame(sync);
    }
  });
  observer.observe(main, { childList: true, subtree: true });
  sync();
  scope.defer(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const child of boards.values()) child.dispose();
    boards.clear();
    style.remove();
  });
}
