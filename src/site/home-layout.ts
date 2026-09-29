import type { Scope } from '../core/scope';
import {
  defaultHomeLayout,
  type HomeLayout,
  type HomeSectionId,
  homeSections,
} from '../shared/home-layout';
import type { Settings } from '../shared/settings';
import css from './home-layout.css?inline';

interface Block {
  id: HomeSectionId;
  heading: HTMLElement;
  body: HTMLElement;
  anchors: [Comment, Comment];
}

// Move original nodes together, retaining their event listeners and live content.
export function createHomeLayout(scope: Scope) {
  const blocks = new Map<HomeSectionId, Block>();
  let current: HomeLayout | undefined;
  let container: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let columns: HTMLElement[] = [];
  let frame = 0;
  const style = document.createElement('style');
  style.dataset.asterveil = 'home-layout';
  style.textContent = css;
  const empty = document.createElement('p');
  empty.className = 'asterveil-home-empty';
  empty.textContent = '所有首页板块已隐藏，可在“设置 → 首页布局”中重新开启。';
  const observer = new MutationObserver((records) => {
    // Ignore clocks, table updates and other changes inside a block.
    if (
      records.some(
        ({ target }) =>
          target === container ||
          target === grid ||
          columns.includes(target as HTMLElement) ||
          (target instanceof HTMLElement && target.matches('.padding, .column')),
      )
    ) {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply();
        });
    }
  });

  function restore() {
    observer.disconnect();

    cancelAnimationFrame(frame);
    frame = 0;
    for (const block of blocks.values()) {
      [block.heading, block.body].forEach((node, index) => {
        const anchor = block.anchors[index];
        node.removeAttribute('data-av-home-hidden');
        if (node.isConnected && anchor?.isConnected) anchor.replaceWith(node);
        else anchor?.remove();
      });
    }
    blocks.clear();
    for (const column of columns) column.removeAttribute('data-av-home-empty');
    grid?.removeAttribute('data-av-home-single');
    grid?.removeAttribute('data-av-home-layout');
    columns = [];
    grid = null;
    style.remove();
    empty.remove();
  }

  function apply() {
    observer.disconnect();

    if (!current || !container?.isConnected || scope.signal.aborted) return;
    const headings = Array.from(
      container.querySelectorAll<HTMLElement>('.column > h4.ui.top.attached.header'),
    );
    const first = headings.find((heading) =>
      homeSections.some(({ title }) => heading.textContent?.trim() === title),
    );
    const nextGrid = first?.parentElement?.parentElement;
    if (!(nextGrid instanceof HTMLElement) || !nextGrid.matches('.ui.grid')) {
      restore();

      observer.observe(container, { childList: true, subtree: true });
      return;
    }
    if (grid && grid !== nextGrid) restore();
    grid = nextGrid;
    const main = grid.querySelector<HTMLElement>(':scope > .ten.wide.column');
    const side = grid.querySelector<HTMLElement>(':scope > .six.wide.column');
    if (!main || !side) {
      observer.observe(container, { childList: true, subtree: true });
      return;
    }
    columns = [main, side];
    for (const [id, block] of blocks) {
      if (block.heading.isConnected && !block.body.isConnected) {
        const replacement = block.heading.nextElementSibling;
        if (
          replacement instanceof HTMLElement &&
          replacement.matches('.ui.bottom.attached.segment')
        ) {
          block.body.removeAttribute('data-av-home-hidden');
          block.body = replacement;
        }
      }
      if (!block.heading.isConnected && block.body.isConnected) {
        const replacement = block.body.previousElementSibling;
        const title = homeSections.find((section) => section.id === id)?.title;
        if (
          replacement instanceof HTMLElement &&
          replacement.matches('h4.ui.top.attached.header') &&
          replacement.textContent?.trim() === title
        ) {
          block.heading.removeAttribute('data-av-home-hidden');
          block.heading = replacement;
        }
      }
      if (block.heading.isConnected && block.body.isConnected) continue;
      for (const anchor of block.anchors) anchor.remove();
      block.heading.removeAttribute('data-av-home-hidden');
      block.body.removeAttribute('data-av-home-hidden');
      blocks.delete(id);
    }
    for (const heading of headings) {
      if (!columns.includes(heading.parentElement as HTMLElement)) continue;
      const section = homeSections.find(({ title }) => heading.textContent?.trim() === title);
      const body = heading.nextElementSibling;
      if (
        !section ||
        blocks.has(section.id) ||
        !(body instanceof HTMLElement) ||
        !body.matches('.ui.bottom.attached.segment')
      )
        continue;
      const anchors: [Comment, Comment] = [
        document.createComment('av-home-heading'),
        document.createComment('av-home-body'),
      ];
      heading.before(anchors[0]);
      body.before(anchors[1]);
      blocks.set(section.id, { id: section.id, heading, body, anchors });
    }
    document.documentElement.append(style);
    grid.setAttribute('data-av-home-layout', '');
    for (const [name, column] of [
      ['main', main],
      ['side', side],
    ] as const) {
      const ordered = current.filter((item) => item.column === name);
      const desired = ordered.flatMap((item) => {
        const block = blocks.get(item.id);
        if (!block) return [];
        for (const node of [block.heading, block.body])
          node.toggleAttribute('data-av-home-hidden', !item.visible);
        return [block.heading, block.body];
      });
      const existing = Array.from(column.children).filter((node) =>
        desired.includes(node as HTMLElement),
      );
      if (
        desired.length !== existing.length ||
        desired.some((node, index) => existing[index] !== node)
      )
        column.append(...desired);
    }
    for (const column of columns) {
      const hasContent = Array.from(column.children).some(
        (node) => !node.matches('script, style, [hidden], [data-av-home-hidden]'),
      );
      column.toggleAttribute('data-av-home-empty', !hasContent);
    }
    const visibleColumns = columns.filter(
      (column) => !column.hasAttribute('data-av-home-empty'),
    ).length;
    grid.toggleAttribute('data-av-home-single', visibleColumns === 1);
    if (visibleColumns === 0) grid.before(empty);
    else empty.remove();
    observer.observe(container, { childList: true, subtree: true });
  }

  scope.defer(restore);
  function update(url: URL, settings: Settings | undefined) {
    const layout = settings?.homeLayout;
    const active =
      url.pathname === '/' &&
      settings?.enabled &&
      settings.modules['home-layout'] &&
      layout &&
      JSON.stringify(layout) !== JSON.stringify(defaultHomeLayout());
    if (!active) {
      current = undefined;
      restore();

      return;
    }
    const nextContainer = document.querySelector<HTMLElement>('.ui.main.container');
    if (current === layout && nextContainer === container) return;
    if (container !== nextContainer) restore();
    container = nextContainer;
    current = layout;
    apply();
  }
  return { update };
}
