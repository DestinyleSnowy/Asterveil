import type { Scope } from '../core/scope';

export function enhancePlans(scope: Scope): void {
  const table = document.querySelector<HTMLTableElement>('.ui.main.container .padding > table.ui');
  if (!table) return;
  const directory = document.createElement('nav');
  directory.className = 'asterveil-plan-index';
  directory.setAttribute('aria-label', '计划日期');
  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'asterveil-plan-handle';
  heading.setAttribute('aria-label', '移动日期目录');
  heading.textContent = '日期';
  const list = document.createElement('div');
  list.className = 'asterveil-plan-dates';
  directory.append(heading, list);
  document.body.append(directory);

  const edges = (['top', 'bottom'] as const).map((edge) => {
    const handle = document.createElement('div');
    handle.className = `asterveil-plan-resize ${edge}`;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', edge === 'top' ? '调整日期目录上边缘' : '调整日期目录下边缘');
    directory.append(handle);
    return { edge, handle };
  });
  let moved = false;
  let resized = false;
  let height = 0;
  let position = { x: 0, y: 0 };
  type DragMode = 'move' | 'top' | 'bottom';
  let drag:
    | {
        id: number;
        x: number;
        y: number;
        left: number;
        top: number;
        height: number;
        mode: DragMode;
      }
    | undefined;
  const minHeight = () => Math.min(140, Math.max(40, innerHeight - 24));
  const place = () => {
    if (directory.hidden) return;
    const width = directory.getBoundingClientRect().width;
    if (!moved) {
      const bounds = table.getBoundingClientRect();
      position = { x: (bounds.left - width) / 2, y: Math.max(76, bounds.top) };
    }
    if (!resized) height = innerHeight - position.y - 12;
    height = Math.max(minHeight(), Math.min(height, innerHeight - 24));
    position.x = Math.max(12, Math.min(position.x, innerWidth - width - 12));
    position.y = Math.max(12, Math.min(position.y, innerHeight - height - 12));
    directory.style.left = `${position.x}px`;
    directory.style.top = `${position.y}px`;
    directory.style.height = `${height}px`;
    for (const { handle } of edges) {
      handle.setAttribute('aria-valuemin', String(minHeight()));
      handle.setAttribute('aria-valuemax', String(innerHeight - 24));
      handle.setAttribute('aria-valuenow', String(Math.round(height)));
    }
  };
  const resize = (edge: 'top' | 'bottom', delta: number, top: number, initialHeight: number) => {
    moved = true;
    resized = true;
    if (edge === 'top') {
      const bottom = top + initialHeight;
      position.y = Math.max(12, Math.min(top + delta, bottom - minHeight()));
      height = bottom - position.y;
    } else height = Math.max(minHeight(), Math.min(initialHeight + delta, innerHeight - top - 12));
    place();
  };
  const controls: { handle: HTMLElement; mode: DragMode }[] = [
    { handle: heading, mode: 'move' },
    ...edges.map(({ edge, handle }) => ({ handle, mode: edge })),
  ];
  for (const { handle, mode } of controls) {
    handle.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        handle.focus({ preventScroll: true });
        drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: position.x,
          top: position.y,
          height,
          mode,
        };
        handle.setPointerCapture(event.pointerId);
        directory.classList.add('is-dragging');
      },
      { signal: scope.signal },
    );
    handle.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!dx && !dy) return;
        if (drag.mode !== 'move') resize(drag.mode, dy, drag.top, drag.height);
        else {
          moved = true;
          resized = true;
          position = { x: drag.left + dx, y: drag.top + dy };
          place();
        }
      },
      { signal: scope.signal },
    );
    const stop = () => {
      drag = undefined;
      directory.classList.remove('is-dragging');
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      handle.addEventListener(type, stop, { signal: scope.signal });
    handle.addEventListener(
      'keydown',
      (event) => {
        const step = event.shiftKey ? 32 : 16;
        if (event.key === 'Home') {
          moved = false;
          resized = false;
        } else if (mode !== 'move' && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          resize(mode, event.key === 'ArrowUp' ? -step : step, position.y, height);
        } else if (mode === 'move') {
          const offsets: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const offset = offsets[event.key];
          if (!offset) return;
          moved = true;
          resized = true;
          position.x += offset[0];
          position.y += offset[1];
        } else return;
        event.preventDefault();
        place();
      },
      { signal: scope.signal },
    );
  }
  window.addEventListener('resize', place, { signal: scope.signal });
  const resizeObserver = new ResizeObserver(place);
  resizeObserver.observe(table);

  const marked = new Set<Element>();
  let entries = new Map<string, { row: HTMLTableRowElement; button: HTMLButtonElement }>();
  let selectedDate: string | undefined;
  let target: HTMLTableRowElement | undefined;
  const select = (date: string) => {
    const entry = entries.get(date);
    if (!entry) return;
    target?.classList.remove('asterveil-plan-target');
    target = entry.row;
    selectedDate = date;
    target.classList.add('asterveil-plan-target');
    for (const [key, { button }] of entries) {
      if (key === date) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    }
    target.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  list.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const date = event.target.closest<HTMLButtonElement>('button[data-date]')?.dataset.date;
      if (date) select(date);
    },
    { signal: scope.signal },
  );

  const update = () => {
    for (const row of marked) row.classList.remove('asterveil-today');
    marked.clear();
    target?.classList.remove('asterveil-plan-target');
    target = undefined;
    const now = new Date();
    const next = new Map<string, { row: HTMLTableRowElement; button: HTMLButtonElement }>();
    for (const row of table.querySelectorAll<HTMLTableRowElement>(
      'tr[data-type="day"][data-date]',
    )) {
      const key = row.dataset.date;
      if (!key || next.has(key)) continue;
      const date = new Date(Number(key) * 1000);
      if (!Number.isFinite(date.getTime())) continue;
      const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const button = entries.get(key)?.button ?? document.createElement('button');
      button.type = 'button';
      button.dataset.date = key;
      if (button.textContent !== label) button.textContent = label;
      const isToday = date.toDateString() === now.toDateString();
      button.classList.toggle('is-today', isToday);
      if (isToday && !row.classList.contains('asterveil-today')) {
        row.classList.add('asterveil-today');
        marked.add(row);
      }
      if (key === selectedDate) {
        target = row;
        target.classList.add('asterveil-plan-target');
        button.setAttribute('aria-current', 'location');
      } else button.removeAttribute('aria-current');
      next.set(key, { row, button });
    }
    const changed = [...entries.keys()].join(',') !== [...next.keys()].join(',');
    entries = next;
    if (changed) {
      const focusedDate = directory.contains(document.activeElement)
        ? (document.activeElement as HTMLButtonElement).dataset.date
        : undefined;
      const scrollTop = list.scrollTop;
      const scrollLeft = list.scrollLeft;
      list.replaceChildren(...[...entries.values()].map(({ button }) => button));
      if (focusedDate) entries.get(focusedDate)?.button.focus({ preventScroll: true });
      list.scrollTop = scrollTop;
      list.scrollLeft = scrollLeft;
    }
    directory.hidden = entries.size === 0;
    place();
  };
  const observer = new MutationObserver(update);
  observer.observe(table, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-date', 'data-type'],
  });
  window.addEventListener('focus', update, { signal: scope.signal });
  update();
  scope.defer(() => {
    observer.disconnect();
    resizeObserver.disconnect();
    directory.remove();
    target?.classList.remove('asterveil-plan-target');
    for (const row of marked) row.classList.remove('asterveil-today');
  });
}
