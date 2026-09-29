import type { Scope } from '../core/scope';

export async function enhanceContestReview(scope: Scope, url: URL): Promise<void> {
  const exercises = [
    ...document.querySelectorAll<HTMLAnchorElement>('.ui.main.container .ui.buttons a[href]'),
  ].find((link) => link.textContent?.trim() === '转到习题');
  if (!exercises) return;
  const source = new URL(exercises.href, url);
  const tag = source.pathname.match(/^\/problems\/tag\/(\d+)\/?$/)?.[1];
  if (source.origin !== url.origin || !tag) return;
  const userId = document
    .querySelector<HTMLAnchorElement>('#user-dropdown a[href^="/user/"]')
    ?.getAttribute('href')
    ?.match(/^\/user\/(\d+)$/)?.[1];

  const response = await fetch(source.href, {
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error('无法读取模测复盘入口');
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (scope.signal.aborted) return;

  const buttons: HTMLAnchorElement[] = [];
  for (const [label, path, icon] of [
    ['写复盘表', '/review/user_tag/edit', 'pencil'],
    ['看复盘表', '/review/user_tags/html', 'eye'],
  ] as const) {
    const original = [...page.querySelectorAll<HTMLAnchorElement>('a[href]')].find((link) => {
      if (link.textContent?.trim() !== label) return false;
      const target = new URL(link.getAttribute('href') ?? '', source);
      return (
        target.origin === url.origin &&
        target.pathname === path &&
        target.searchParams.get('tag_id') === tag &&
        (icon !== 'pencil' || (!!userId && target.searchParams.get('user_id') === userId))
      );
    });
    if (!original) continue;
    const button = document.createElement('a');
    button.className = 'ui small button';
    button.dataset.asterveil = 'contest-review';
    button.href = new URL(original.getAttribute('href') ?? '', source).href;
    const symbol = document.createElement('i');
    symbol.className = `${icon} icon`;
    symbol.setAttribute('aria-hidden', 'true');
    button.append(symbol, label);
    buttons.push(button);
  }
  exercises.parentElement?.append(...buttons);
  scope.defer(() => {
    for (const button of buttons) button.remove();
  });
}
