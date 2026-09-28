import type { Scope } from '../core/scope';
import css from './home-performance.css?inline';

const panelSelector = '.ui.main.container .ui.grid > .column > .ui.bottom.attached.segment';
const renderAttribute = 'data-asterveil-render';
const heightProperty = '--asterveil-render-height';
type HintName = 'decoding' | 'fetchpriority';
type Hint = { original: string | null; replacement: string };

export function enhanceHomePerformance(scope: Scope, url: URL) {
  const hints = new Map<HTMLImageElement, Map<HintName, Hint>>();
  let prunePanels = () => {};
  const restoreHints = (image: HTMLImageElement) => {
    for (const [name, hint] of hints.get(image) ?? []) {
      if (image.getAttribute(name) !== hint.replacement) continue;
      if (hint.original === null) image.removeAttribute(name);
      else image.setAttribute(name, hint.original);
    }
    hints.delete(image);
  };
  const hint = (image: HTMLImageElement, name: HintName, value: string) => {
    const original = image.getAttribute(name);
    // Respect explicit site choices, including lazy loading and low priority.
    if (original !== null && original !== 'auto') return;
    let saved = hints.get(image);
    if (!saved) {
      saved = new Map();
      hints.set(image, saved);
    }
    saved.set(name, { original, replacement: value });
    image.setAttribute(name, value);
  };
  const updateImage = (image: HTMLImageElement) => {
    const raw = image.getAttribute('src');
    if (!raw?.includes('/index_image/')) {
      restoreHints(image);
      return;
    }
    let source: URL;
    try {
      source = new URL(raw, url);
    } catch {
      restoreHints(image);
      return;
    }
    if (source.origin !== url.origin || !/^\/index_image\/\d+$/.test(source.pathname)) {
      restoreHints(image);
      return;
    }
    // Preserve the image URL and pixels; no external CDN, cache or extra request.
    hint(image, 'decoding', 'async');
    hint(image, 'fetchpriority', 'high');
  };
  const scan = (root: ParentNode) => {
    if (root instanceof HTMLImageElement) updateImage(root);
    root.querySelectorAll<HTMLImageElement>('img[src*="/index_image/"]').forEach(updateImage);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement)
        updateImage(record.target);
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
    if (records.some((record) => record.removedNodes.length > 0)) {
      for (const image of hints.keys()) if (!image.isConnected) restoreHints(image);
      prunePanels();
    }
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  scan(document);
  scope.defer(() => {
    observer.disconnect();
    for (const image of hints.keys()) restoreHints(image);
  });

  const mountPanels = () => {
    if (scope.signal.aborted || !CSS.supports('content-visibility', 'auto')) return;
    const panels = new Map<
      HTMLElement,
      { marker: string | null; height: string; priority: string; appliedHeight: string }
    >();
    const style = document.createElement('style');
    style.dataset.asterveil = 'home-performance';
    style.textContent = css;
    document.documentElement.append(style);
    const restorePanel = (panel: HTMLElement) => {
      const saved = panels.get(panel);
      if (!saved) return;
      if (panel.getAttribute(renderAttribute) === 'auto') {
        if (saved.marker === null) panel.removeAttribute(renderAttribute);
        else panel.setAttribute(renderAttribute, saved.marker);
      }
      if (panel.style.getPropertyValue(heightProperty) === saved.appliedHeight) {
        if (saved.height) panel.style.setProperty(heightProperty, saved.height, saved.priority);
        else panel.style.removeProperty(heightProperty);
      }
      panels.delete(panel);
    };
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const panel = entry.target as HTMLElement;
        const saved = panels.get(panel);
        if (!saved || entry.contentRect.height <= 0) continue;
        // ResizeObserver gives the content box: border/padding must not be counted twice.
        const height = `${entry.contentRect.height}px`;
        if (saved.appliedHeight !== height) {
          saved.appliedHeight = height;
          panel.style.setProperty(heightProperty, height);
        }
        // The first layout is measured normally, preserving the real scroll extent.
        if (panel.getAttribute(renderAttribute) !== 'auto')
          panel.setAttribute(renderAttribute, 'auto');
      }
    });
    for (const panel of document.querySelectorAll<HTMLElement>(panelSelector)) {
      panels.set(panel, {
        marker: panel.getAttribute(renderAttribute),
        height: panel.style.getPropertyValue(heightProperty),
        priority: panel.style.getPropertyPriority(heightProperty),
        appliedHeight: '',
      });
      resize.observe(panel);
    }
    prunePanels = () => {
      for (const panel of panels.keys()) {
        if (panel.isConnected) continue;
        resize.unobserve(panel);
        restorePanel(panel);
      }
    };
    scope.defer(() => {
      resize.disconnect();
      for (const panel of panels.keys()) restorePanel(panel);
      style.remove();
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPanels, {
      once: true,
      signal: scope.signal,
    });
  } else mountPanels();
}
