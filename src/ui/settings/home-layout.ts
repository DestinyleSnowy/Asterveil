import type { Scope } from '../../core/scope';
import { type HomeColumn, type HomeSectionId, homeSections } from '../../shared/home-layout';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';
import { settingsIcon } from './icons';

export function mountHomeLayoutSettings(
  root: ParentNode,
  scope: Scope,
  save: (command: SettingsCommand) => Promise<void>,
) {
  const section = root.querySelector<HTMLElement>('.home-layout-settings');
  if (!section) throw new Error('Home layout settings missing');
  const toggle = section.querySelector<HTMLInputElement>('#home-layout-enabled');
  const controls = section.querySelector<HTMLFieldSetElement>('#home-layout-controls');
  const reset = section.querySelector<HTMLButtonElement>('#home-layout-reset');
  if (!toggle || !controls || !reset) throw new Error('Home layout controls missing');
  const lists = new Map<HomeColumn, HTMLOListElement>();
  const rows = new Map<
    HomeSectionId,
    {
      row: HTMLLIElement;
      visible: HTMLInputElement;
      column: HTMLSelectElement;
      up: HTMLButtonElement;
      down: HTMLButtonElement;
    }
  >();
  let current: Settings | undefined;
  let busy = false;
  let dragging: HomeSectionId | undefined;
  const options = { signal: scope.signal };

  async function commit(command: SettingsCommand) {
    if (busy || !current) return;
    const focused = section?.getRootNode() as Document | ShadowRoot;
    const active = focused.activeElement;
    busy = true;
    render(current);
    try {
      await save(command);
    } finally {
      busy = false;
      render(current);
      if (active instanceof HTMLElement && active.isConnected)
        active.focus({ preventScroll: true });
    }
  }

  function move(id: HomeSectionId, direction: -1 | 1) {
    const item = current?.homeLayout.find((item) => item.id === id);
    if (!item || !current) return;
    const siblings = current.homeLayout.filter((entry) => entry.column === item.column);
    const index = siblings.findIndex((entry) => entry.id === id);
    if (!siblings[index + direction]) return;
    const before = siblings[index + (direction === -1 ? -1 : 2)]?.id ?? null;
    void commit({ type: 'settings.home.move', id, column: item.column, before });
  }

  function clearDrag() {
    dragging = undefined;
    for (const { row } of rows.values()) row.classList.remove('is-dragging', 'drop-before');
    for (const list of lists.values()) list.classList.remove('drop-end');
  }
  for (const column of ['main', 'side'] as const) {
    const list = section.querySelector<HTMLOListElement>(`[data-home-column="${column}"]`);
    if (!list) throw new Error('Home layout column missing');
    lists.set(column, list);
    list.addEventListener(
      'dragover',
      (event) => {
        if (!dragging || controls.disabled || busy) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        for (const { row } of rows.values()) row.classList.remove('drop-before');
        for (const other of lists.values()) other.classList.remove('drop-end');
        const row = (event.target as Element).closest<HTMLElement>('[data-home-id]');
        if (row) row.classList.add('drop-before');
        else list.classList.add('drop-end');
      },
      options,
    );
    list.addEventListener(
      'drop',
      (event) => {
        event.preventDefault();
        if (!dragging || controls.disabled || busy) return;
        const id = dragging;
        const target = (event.target as Element).closest<HTMLElement>('[data-home-id]');
        const before = homeSections.find((item) => item.id === target?.dataset.homeId)?.id ?? null;
        clearDrag();
        void commit({ type: 'settings.home.move', id, column, before });
      },
      options,
    );
  }
  for (const item of homeSections) {
    const row = document.createElement('li');
    row.className = 'home-layout-row';
    row.dataset.homeId = item.id;
    const handle = document.createElement('span');
    handle.className = 'home-drag-handle';
    handle.draggable = true;
    handle.title = `拖动排列${item.title}，也可使用上移和下移按钮`;
    handle.innerHTML = settingsIcon('grip');
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener(
      'dragstart',
      (event) => {
        if (controls.disabled || busy) {
          event.preventDefault();
          return;
        }
        dragging = item.id;
        row.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', item.id);
          event.dataTransfer.setDragImage(row, 20, 20);
        }
      },
      options,
    );
    handle.addEventListener('dragend', clearDrag, options);
    const label = document.createElement('label');
    label.className = 'home-section-label';
    const visible = document.createElement('input');
    visible.type = 'checkbox';
    visible.setAttribute('aria-label', `显示${item.title}`);
    const title = document.createElement('span');
    title.textContent = item.title;
    label.append(visible, title);
    visible.addEventListener(
      'change',
      () => void commit({ type: 'settings.home.visible', id: item.id, visible: visible.checked }),
      options,
    );
    const column = document.createElement('select');
    column.setAttribute('aria-label', `${item.title}所在栏`);
    column.add(new Option('左栏', 'main'));
    column.add(new Option('右栏', 'side'));
    column.addEventListener(
      'change',
      () =>
        void commit({
          type: 'settings.home.move',
          id: item.id,
          column: column.value === 'main' ? 'main' : 'side',
          before: null,
        }),
      options,
    );
    const up = document.createElement('button');
    const down = document.createElement('button');
    for (const [button, direction, text, icon] of [
      [up, -1, '上移', 'up'],
      [down, 1, '下移', 'down'],
    ] as const) {
      button.type = 'button';
      button.className = 'home-order-button';
      button.title = `${text}${item.title}`;
      button.setAttribute('aria-label', button.title);
      button.innerHTML = settingsIcon(icon);
      button.addEventListener('click', () => move(item.id, direction), options);
    }
    row.append(handle, label, column, up, down);
    rows.set(item.id, { row, visible, column, up, down });
  }
  toggle.addEventListener(
    'change',
    () =>
      void commit({ type: 'settings.module', moduleId: 'home-layout', enabled: toggle.checked }),
    options,
  );
  reset.addEventListener('click', () => void commit({ type: 'settings.home.reset' }), options);
  scope.defer(clearDrag);

  function render(settings: Settings | undefined) {
    current = settings;
    if (!toggle || !controls) return;
    toggle.checked = Boolean(settings?.modules['home-layout']);
    toggle.setAttribute('aria-checked', String(toggle.checked));
    toggle.disabled = busy || !settings?.enabled;
    controls.disabled = busy || !settings?.enabled || !settings.modules['home-layout'];
    for (const [column, list] of lists) {
      const entries = settings?.homeLayout.filter((item) => item.column === column) ?? [];
      entries.forEach((item, index) => {
        const entry = rows.get(item.id);
        if (!entry) return;
        entry.visible.checked = item.visible;
        entry.column.value = item.column;
        entry.row.classList.toggle('is-hidden', !item.visible);
        entry.up.disabled = index === 0;
        entry.down.disabled = index === entries.length - 1;
        if (list.children[index] !== entry.row)
          list.insertBefore(entry.row, list.children[index] ?? null);
      });
    }
  }
  return { render };
}
