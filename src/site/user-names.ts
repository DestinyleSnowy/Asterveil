import type { Scope } from '../core/scope';
import {
  type UserGrade,
  type UserGradePalette,
  userGradeColor,
  userGradeLabel,
} from '../shared/user-name-palette';
import { resolveSite } from './target';

const ignored =
  'script, style, pre, code, textarea, input, select, button, svg, math, [contenteditable]:not([contenteditable="false"]), [role="button"], .ui.button, #user-dropdown';
const decoration =
  'i, .icon, .label, .badge, .tag, .rating, .rank, .bn-user-tags, [aria-hidden="true"]';
type TextChange = { original: string; replacement: string };
type AttributeChange = { original: string | null; replacement: string };
type ColorChange = {
  element: HTMLElement;
  original: string;
  priority: string;
  replacement: string;
  hadStyle: boolean;
};
type Change = {
  id: string;
  inserted: Text | undefined;
  texts: Map<Text, TextChange>;
  attributes: Map<string, AttributeChange>;
  colors: ColorChange[];
};

interface NameAppearance {
  readonly grades: ReadonlyMap<string, UserGrade>;
  readonly palette: UserGradePalette;
}

export function profileUserId(href: string, base: URL): string | undefined {
  try {
    const target = new URL(href, base);
    if (!resolveSite(target) || target.username || target.password) return;
    const id = target.pathname.match(/^\/user\/([1-9]\d*)\/?$/)?.[1];
    if (id && Number.isSafeInteger(Number(id))) return id;
  } catch {
    // A broken link is not a user label.
  }
}

export function replaceUserNames(
  scope: Scope,
  url: URL,
  names: ReadonlyMap<string, string>,
  appearance?: NameAppearance,
): void {
  const changes = new WeakMap<HTMLAnchorElement, Change>();
  const tracked = new Set<WeakRef<HTMLAnchorElement>>();
  const pending = new Set<HTMLAnchorElement>();
  let frame = 0;

  const restore = (link: HTMLAnchorElement) => {
    const change = changes.get(link);
    if (!change) return;
    for (const [text, { original, replacement }] of change.texts)
      if (link.contains(text) && text.data === replacement) {
        if (text === change.inserted) text.remove();
        else text.data = original;
      }
    for (const [key, { original, replacement }] of change.attributes) {
      if (link.getAttribute(key) !== replacement) continue;
      if (original === null) link.removeAttribute(key);
      else link.setAttribute(key, original);
    }
    for (const { element, original, priority, replacement, hadStyle } of change.colors) {
      if (
        element.style.getPropertyValue('color') !== replacement ||
        element.style.getPropertyPriority('color') !== 'important'
      )
        continue;
      if (original) element.style.setProperty('color', original, priority);
      else element.style.removeProperty('color');
      if (!hadStyle && !element.getAttribute('style')?.trim()) element.removeAttribute('style');
    }
    changes.delete(link);
  };
  const textNodes = (link: HTMLAnchorElement): Text[] => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim() && !node.parentElement?.closest(`${ignored}, ${decoration}`))
        nodes.push(node as Text);
    }
    return nodes;
  };
  const emptyNameSlot = (link: HTMLAnchorElement, id: string): boolean => {
    const cell = link.closest('td.name, th.name');
    if (!cell || link.closest(decoration)) return false;
    const labels = [...cell.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
      (candidate) =>
        candidate.closest('td, th') === cell &&
        !candidate.closest(`${ignored}, ${decoration}`) &&
        profileUserId(candidate.getAttribute('href') ?? '', url) === id,
    );
    // A separate avatar link must not duplicate the adjacent username link.
    return (
      labels.at(-1) === link && !labels.some((other) => other !== link && textNodes(other).length)
    );
  };
  const update = (link: HTMLAnchorElement) => {
    const id = profileUserId(link.getAttribute('href') ?? '', url);
    const name = id && names.get(id);
    if (!id || !name || link.closest(ignored)) {
      restore(link);
      return;
    }
    const saved = changes.get(link);
    if (saved) {
      const current = textNodes(link);
      const unchanged =
        saved.id === id &&
        saved.colors.every(
          ({ element, replacement }) =>
            element.style.getPropertyValue('color') === replacement &&
            element.style.getPropertyPriority('color') === 'important',
        ) &&
        current.every((text) => saved.texts.get(text)?.replacement === text.data) &&
        [...saved.texts].every(
          ([text, change]) => link.contains(text) && text.data === change.replacement,
        );
      if (unchanged) return;
      restore(link);
    }
    const texts = textNodes(link);
    const label = texts
      .map((text) => text.data)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      (!label && !emptyNameSlot(link, id)) ||
      (!appearance && label === name) ||
      /^(?:https?:\/\/|\/\/|www\.|\/user\/)/i.test(label)
    )
      return;
    let inserted: Text | undefined;
    if (!label) {
      inserted = document.createTextNode('');
      const avatar = [...link.children]
        .reverse()
        .find((child) => child.matches('img, picture') || child.querySelector('img, picture'));
      if (avatar) avatar.after(inserted);
      else link.prepend(inserted);
      texts.push(inserted);
    }
    const change: Change = { id, inserted, texts: new Map(), attributes: new Map(), colors: [] };
    changes.set(link, change);
    if (!saved) tracked.add(new WeakRef(link));
    texts.forEach((text, index) => {
      const original = text.data;
      const replacement =
        text === inserted
          ? `${link.querySelector('img, picture') ? ' ' : ''}${name}`
          : index === 0
            ? `${original.match(/^\s*/)?.[0] ?? ''}${name}${original.match(/\s*$/)?.[0] ?? ''}`
            : '';
      change.texts.set(text, { original, replacement });
      if (original !== replacement) text.data = replacement;
    });
    const attribute = (key: string, replacement: string) => {
      const original = link.getAttribute(key);
      if (original === replacement) return;
      change.attributes.set(key, { original, replacement });
      link.setAttribute(key, replacement);
    };
    const grade = appearance?.grades.get(id) ?? 'uk';
    const color = appearance && userGradeColor(grade, appearance.palette);
    if (color) {
      for (const element of new Set([link, texts[0]?.parentElement])) {
        if (!element) continue;
        const original = element.style.getPropertyValue('color');
        const priority = element.style.getPropertyPriority('color');
        const hadStyle = element.hasAttribute('style');
        element.style.setProperty('color', color, 'important');
        change.colors.push({
          element,
          original,
          priority,
          hadStyle,
          replacement: element.style.getPropertyValue('color'),
        });
      }
    }
    const description = [
      !label ? '原用户名为空' : label !== name ? `原用户名：${label}` : '',
      appearance ? userGradeLabel(grade) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const title = link.getAttribute('title');
    attribute('title', title ? `${title}\n${description}` : description);
    if (!link.hasAttribute('aria-description') && !link.hasAttribute('aria-describedby'))
      attribute('aria-description', description);
    if (link.getAttribute('aria-label')?.trim() === label) attribute('aria-label', name);
  };
  const scan = (root: ParentNode) => {
    if (root instanceof HTMLAnchorElement && root.hasAttribute('href')) pending.add(root);
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) pending.add(link);
  };
  const containingLink = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    const link = element?.closest<HTMLAnchorElement>('a[href]');
    if (link) pending.add(link);
  };
  const flush = () => {
    frame = 0;
    if (scope.signal.aborted) return;
    for (const link of pending) if (link.isConnected) update(link);
    pending.clear();
  };
  const observer = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      containingLink(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
        else containingLink(node);
      }
      if (!removed) removed = [...record.removedNodes].some((node) => node instanceof Element);
    }
    if (removed) for (const reference of tracked) if (!reference.deref()) tracked.delete(reference);
    if (pending.size && !frame) frame = requestAnimationFrame(flush);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: appearance ? ['href', 'style'] : ['href'],
  });
  scan(document.body);
  flush();
  scope.defer(() => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    pending.clear();
    for (const reference of tracked) {
      const link = reference.deref();
      if (link) restore(link);
    }
    tracked.clear();
  });
}
