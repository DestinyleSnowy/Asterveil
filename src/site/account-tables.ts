import type { Scope } from '../core/scope';

export function enhanceAccountTables(scope: Scope) {
  const main = document.querySelector<HTMLElement>('.ui.main.container');
  if (!main) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'asterveil-table-toolbar';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ui button asterveil-table-size';
  const previous = main.getAttribute('data-asterveil-table-size');
  const marked = new Set<Element>();
  let compact = false;
  const render = () => {
    main.setAttribute('data-asterveil-table-size', compact ? 'compact' : 'wide');
    toggle.textContent = compact ? '宽版显示' : '紧凑显示';
    toggle.setAttribute('aria-pressed', String(compact));
    toggle.setAttribute('aria-label', compact ? '切换为宽版显示' : '切换为紧凑显示');
  };
  toggle.addEventListener(
    'click',
    () => {
      compact = !compact;
      render();
    },
    { signal: scope.signal },
  );
  toolbar.append(toggle);

  // Move the original nodes so download/navigation handlers remain intact.
  const moved = new Map<Element, Comment>();
  const move = (element: Element, before: Node | null = toggle) => {
    const marker = document.createComment('asterveil-table-action');
    element.before(marker);
    moved.set(element, marker);
    toolbar.insertBefore(element, before);
  };
  const sync = () => {
    // Mark the table once from its header. Relational selectors on every cell
    // otherwise re-walk a large tbody during the site's clear/append refresh.
    const current = new Set<Element>();
    let hasWideTable = false;
    for (const table of main.querySelectorAll<HTMLTableElement>('.padding > .ui.table')) {
      const wide = (table.rows[0]?.cells.length ?? 0) >= 8;
      table.classList.toggle('asterveil-wide-table', wide);
      if (wide) {
        hasWideTable = true;
        current.add(table);
        const parent = table.parentElement;
        if (parent) {
          parent.classList.add('asterveil-wide-padding');
          current.add(parent);
        }
      }
    }
    for (const element of marked) {
      if (!current.has(element)) {
        element.classList.remove('asterveil-wide-table', 'asterveil-wide-padding');
        marked.delete(element);
      }
    }
    for (const element of current) marked.add(element);
    main.classList.toggle('asterveil-has-wide-table', hasWideTable);
    const padding = main.querySelector<HTMLElement>('.asterveil-wide-padding');
    if (!padding) return;
    const options = padding.querySelector(':scope > .ui.button.dropdown');
    const actions = main.querySelectorAll(':scope > a.ui.button');
    if (options) {
      // Ajax ranking refreshes can replace the original action row.
      for (const [element, marker] of moved) {
        if (!marker.isConnected) {
          element.remove();
          moved.delete(element);
        }
      }
      padding.prepend(toolbar);
      toolbar.classList.add('asterveil-table-toolbar-inline');
      toggle.classList.remove('asterveil-table-size-inline');
      toolbar.append(toggle);
      move(options);
      const autoUpdate = main.querySelector(':scope > .ui.toggle.checkbox');
      if (autoUpdate) move(autoUpdate);
      const boardAction = padding.querySelector(':scope > .ui.right.floated.button');
      if (boardAction) move(boardAction, null);
      render();
    } else if (actions.length) {
      if (!toolbar.isConnected) main.prepend(toolbar);
      for (const button of actions) move(button);
      render();
    } else if (!toggle.isConnected) {
      toggle.classList.add('asterveil-table-size-inline');
      padding.prepend(toggle);
      render();
    }
  };
  let frame = 0;
  const observer = new MutationObserver((records) => {
    // Score refreshes and filter labels cannot add or replace a toolbar.
    if (
      !records.some(
        (record) =>
          record.target instanceof Element &&
          !record.target.closest('table, .asterveil-ranking-filters, .asterveil-table-toolbar'),
      )
    )
      return;
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
  });
  observer.observe(main, { childList: true, subtree: true });
  sync();
  scope.defer(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const [button, marker] of moved) {
      if (marker.parentNode) marker.replaceWith(button);
    }
    toolbar.remove();
    toggle.remove();
    main.classList.remove('asterveil-has-wide-table');
    for (const element of marked)
      element.classList.remove('asterveil-wide-table', 'asterveil-wide-padding');
    marked.clear();
    if (previous === null) main.removeAttribute('data-asterveil-table-size');
    else main.setAttribute('data-asterveil-table-size', previous);
  });
}
