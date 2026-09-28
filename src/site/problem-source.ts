import type { Scope } from '../core/scope';
import { copyText } from '../platform/clipboard';

export function enhanceProblemSource(scope: Scope, url: URL): void {
  const problemId = url.pathname.match(/\/problem\/(\d+)\/?$/)?.[1];
  if (!problemId) return;
  const sourceLink = [...document.querySelectorAll<HTMLAnchorElement>('a.ui.button[href]')].find(
    (link) => {
      const target = new URL(link.href, url);
      return (
        target.origin === url.origin && target.pathname === `/problem/${problemId}/markdown/html`
      );
    },
  );
  if (!sourceLink) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'small ui button';
  button.dataset.asterveil = 'copy-problem-source';
  button.textContent = '复制源码';
  button.setAttribute('aria-live', 'polite');
  sourceLink.after(button);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  button.addEventListener(
    'click',
    async () => {
      clearTimeout(resetTimer);
      button.disabled = true;
      button.textContent = '复制中…';
      try {
        const response = await fetch(sourceLink.href, {
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error('Source request failed');
        const html = await response.text();
        const source = new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelector('body > pre');
        if (!source) throw new Error('Source content missing');
        const text = source.textContent ?? '';
        if (scope.signal.aborted) return;
        await copyText(text, scope.signal);
        if (!scope.signal.aborted) button.textContent = '已复制';
      } catch {
        if (!scope.signal.aborted) button.textContent = '复制失败';
      } finally {
        if (!scope.signal.aborted) {
          button.disabled = false;
          resetTimer = setTimeout(() => {
            button.textContent = '复制源码';
          }, 2000);
        }
      }
    },
    { signal: scope.signal },
  );
  scope.defer(() => {
    clearTimeout(resetTimer);
    button.remove();
  });
}
