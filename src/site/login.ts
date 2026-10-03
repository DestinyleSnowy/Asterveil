import type { Scope } from '../core/scope';

export function enhanceLogin(scope: Scope): void {
  const form = document.querySelector('.ui.main.container form.ui.form');
  const button = form?.querySelector<HTMLElement>('#login');
  if (!button) return;

  const set = (element: Element, name: string, value: string) => {
    const previous = element.getAttribute(name);
    element.setAttribute(name, value);
    scope.defer(() => {
      if (element.getAttribute(name) !== value) return;
      if (previous === null) element.removeAttribute(name);
      else element.setAttribute(name, previous);
    });
  };
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) set(viewport, 'content', 'width=device-width, initial-scale=1');
  // Whitespace-only native notices should match :empty, while later messages stay visible.
  for (const message of form?.parentElement?.querySelectorAll('.ui.message') ?? []) {
    const whitespace = message.textContent ?? '';
    if (message.children.length || whitespace.trim()) continue;
    message.textContent = '';
    scope.defer(() => {
      if (!message.hasChildNodes()) message.textContent = whitespace;
    });
  }
  for (const input of form?.querySelectorAll('input[placeholder]') ?? []) {
    if (!input.hasAttribute('aria-label'))
      set(input, 'aria-label', input.getAttribute('placeholder') ?? '');
  }
  set(button, 'role', 'button');
  set(button, 'tabindex', '0');
  button.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      button.click();
    },
    { signal: scope.signal },
  );
}
