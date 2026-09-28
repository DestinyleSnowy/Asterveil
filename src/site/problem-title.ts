import type { Scope } from '../core/scope';
import { copyText } from '../platform/clipboard';

export function enhanceProblemTitle(scope: Scope): void {
  const heading = document.querySelector<HTMLElement>('.ui.main.container h1');
  if (!heading) return;
  const originalTitle = heading.getAttribute('title');
  heading.title = '双击复制标题';
  heading.classList.add('asterveil-copy-title');
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let copying = false;
  heading.addEventListener(
    'dblclick',
    async () => {
      const text = heading.innerText.trim();
      if (!text || copying) return;
      copying = true;
      clearTimeout(resetTimer);
      try {
        await copyText(text, scope.signal);
        if (!scope.signal.aborted) heading.dataset.asterveilCopyStatus = '已复制';
      } catch {
        if (!scope.signal.aborted) heading.dataset.asterveilCopyStatus = '复制失败';
      } finally {
        copying = false;
        if (!scope.signal.aborted) {
          resetTimer = setTimeout(() => {
            delete heading.dataset.asterveilCopyStatus;
          }, 1500);
        }
      }
    },
    { signal: scope.signal },
  );
  scope.defer(() => {
    clearTimeout(resetTimer);
    heading.classList.remove('asterveil-copy-title');
    delete heading.dataset.asterveilCopyStatus;
    if (originalTitle === null) heading.removeAttribute('title');
    else heading.setAttribute('title', originalTitle);
  });
}
