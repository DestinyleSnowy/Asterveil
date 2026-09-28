import type { Scope } from '../core/scope';
import { avatarDataUrl, gravatarIdentity } from '../shared/avatar';

const attributes = ['src', 'srcset', 'data-src', 'data-srcset', 'data-original'];
type Change = { original: string; replacement: string };

export function replaceGravatarImages(scope: Scope) {
  const changes = new WeakMap<Element, Map<string, Change>>();
  const tracked = new Set<WeakRef<Element>>();
  const cache = new Map<string, string>();
  const replaceUrl = (url: string) => {
    const identity = gravatarIdentity(url);
    if (identity === undefined) return url;
    let replacement = cache.get(identity);
    if (!replacement) {
      replacement = avatarDataUrl(identity);
      if (cache.size >= 512) cache.clear();
      cache.set(identity, replacement);
    }
    return replacement;
  };
  const update = (element: Element) => {
    if (!element.matches('img, picture > source')) return;
    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const replacement = name.endsWith('srcset')
        ? value.replace(/(?:https?:)?\/\/[^\s,]+/gi, replaceUrl)
        : replaceUrl(value);
      if (replacement === value) continue;
      let saved = changes.get(element);
      if (!saved) {
        saved = new Map();
        changes.set(element, saved);
        tracked.add(new WeakRef(element));
      }
      saved.set(name, { original: value, replacement });
      element.setAttribute(name, replacement);
    }
  };
  const scan = (root: ParentNode) => {
    if (root instanceof Element) update(root);
    root.querySelectorAll('img, picture > source').forEach(update);
  };
  const observer = new MutationObserver((records) => {
    // Removed tables must not stay alive merely so their avatars can be restored.
    if (records.some((record) => record.removedNodes.length > 0)) {
      for (const reference of tracked) if (!reference.deref()) tracked.delete(reference);
    }
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) update(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: attributes,
  });
  scan(document);
  scope.defer(() => {
    observer.disconnect();
    for (const reference of tracked) {
      const element = reference.deref();
      const saved = element && changes.get(element);
      if (!element || !saved) continue;
      for (const [name, { original, replacement }] of saved) {
        // Preserve any later changes made by the site or another extension.
        if (element.getAttribute(name) === replacement) element.setAttribute(name, original);
      }
    }
    tracked.clear();
    cache.clear();
  });
}
