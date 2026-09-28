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
    const padding = main.querySelector<HTMLElement>('.padding:has(> .ui.table tr > :nth-child(8))');
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
  const observer = new MutationObserver(sync);
  observer.observe(main, { childList: true, subtree: true });
  sync();
  scope.defer(() => {
    observer.disconnect();
    for (const [button, marker] of moved) {
      if (marker.parentNode) marker.replaceWith(button);
    }
    toolbar.remove();
    toggle.remove();
    if (previous === null) main.removeAttribute('data-asterveil-table-size');
    else main.setAttribute('data-asterveil-table-size', previous);
  });
}
