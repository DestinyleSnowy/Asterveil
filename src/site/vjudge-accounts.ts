import type { Scope } from '../core/scope';

export function enhanceVjudgeAccounts(scope: Scope): void {
  const form = document.querySelector<HTMLFormElement>('#bind-form');
  if (!form) return;
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

  const names: Record<string, string> = {
    'BIND NEW ACCOUNT': '绑定新账号',
    USERNAME: '用户名',
    PASSWORD: '密码',
    BIND: '绑定',
  };
  const heading = form.parentElement?.querySelector(':scope > .ui.header');
  const labels = form.querySelectorAll('label');
  const submit = form.querySelector('button[type="submit"]');
  for (const element of [heading, ...labels, submit]) {
    if (!element || element.children.length) continue;
    const previous = element.textContent ?? '';
    const name = names[previous.trim()];
    if (!name) continue;
    element.textContent = name;
    scope.defer(() => {
      if (element.textContent === name) element.textContent = previous;
    });
  }
  for (const field of form.querySelectorAll('.field')) {
    const input = field.querySelector('input');
    const label = field.querySelector('label')?.textContent?.trim();
    if (
      input &&
      label &&
      !input.hasAttribute('aria-label') &&
      !input.hasAttribute('aria-labelledby')
    )
      set(input, 'aria-label', label);
  }

  const select = form.querySelector<HTMLSelectElement>('select[name="foreign_oj"]');
  if (!select) return;
  const options = [...select.options].filter((option) => option.value && !option.disabled);
  if (!options.length || options.length > 4) return;

  const picker = document.createElement('div');
  picker.className = 'asterveil-vjudge-oj-options';
  picker.setAttribute('role', 'group');
  picker.setAttribute(
    'aria-label',
    select.parentElement?.querySelector('label')?.textContent ?? 'OJ',
  );
  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.textContent?.trim() ?? '';
    button.addEventListener(
      'click',
      () => {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { signal: scope.signal },
    );
    picker.append(button);
    return button;
  });
  const update = () => {
    buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(select.value === options[index]?.value));
      button.disabled = select.disabled;
    });
  };
  select.addEventListener('change', update, { signal: scope.signal });
  form.addEventListener('reset', () => queueMicrotask(() => !scope.signal.aborted && update()), {
    signal: scope.signal,
  });
  set(select, 'hidden', '');
  select.after(picker);
  scope.defer(() => picker.remove());
  update();
}
