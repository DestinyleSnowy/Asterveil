import type { Scope } from '../core/scope';

export function enhanceProblemActionTooltips(scope: Scope): void {
  const buttons = document.querySelectorAll<HTMLElement>(
    '.ui.main.container > .ui.grid > .row > .column > .ui.buttons > .ui.button[data-tooltip]',
  );
  for (const button of buttons) {
    const tooltip = button.getAttribute('data-tooltip');
    if (!tooltip?.trim()) continue;
    const set = (name: string, value: string) => {
      const previous = button.getAttribute(name);
      button.setAttribute(name, value);
      scope.defer(() => {
        if (button.getAttribute(name) !== value) return;
        if (previous === null) button.removeAttribute(name);
        else button.setAttribute(name, previous);
      });
    };
    if (!button.hasAttribute('aria-label') && !button.hasAttribute('aria-labelledby'))
      set('aria-label', button.textContent?.trim() ?? '');
    if (!button.hasAttribute('aria-describedby') && !button.hasAttribute('aria-description'))
      set('aria-description', tooltip);

    const property = '--av-tooltip-offset';
    const previousOffset = button.style.getPropertyValue(property);
    const previousPriority = button.style.getPropertyPriority(property);
    let offset: string | undefined;
    const position = () => {
      const rect = button.getBoundingClientRect();
      const width = Number.parseFloat(getComputedStyle(button, '::after').width);
      if (!Number.isFinite(width)) return;
      const center = rect.left + rect.width / 2;
      const left = Math.max(
        16,
        Math.min(center - width / 2, document.documentElement.clientWidth - width - 16),
      );
      offset = `${left + width / 2 - center}px`;
      button.style.setProperty(property, offset);
    };
    button.addEventListener('pointerenter', position, { signal: scope.signal });
    button.addEventListener('focus', position, { signal: scope.signal });
    window.addEventListener('resize', position, { signal: scope.signal });
    position();
    scope.defer(() => {
      if (offset === undefined || button.style.getPropertyValue(property) !== offset) return;
      if (previousOffset) button.style.setProperty(property, previousOffset, previousPriority);
      else button.style.removeProperty(property);
    });

    // The native skip action is an anchor with a click handler but no href.
    if (!button.matches('a.check-need-button:not([href])')) continue;
    if (!button.hasAttribute('role')) set('role', 'button');
    if (!button.hasAttribute('tabindex')) set('tabindex', '0');
    button.addEventListener(
      'keydown',
      (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        if (!event.repeat) button.click();
      },
      { signal: scope.signal },
    );
  }
}
