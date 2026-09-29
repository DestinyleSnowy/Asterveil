import type { Scope } from '../core/scope';
import { copyText } from '../platform/clipboard';

export function enhanceSubmissionCode(scope: Scope): void {
  const container = document.querySelector<HTMLElement>('#submission_content');
  if (!container) return;
  const selector = '[data-asterveil="copy-submission-code"]';
  let frame = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let activeButton: HTMLButtonElement | undefined;
  const mount = () => {
    frame = 0;
    if (scope.signal.aborted) return;
    for (const panel of container.querySelectorAll('.ui.existing.segment')) {
      if (
        panel.querySelector(selector) ||
        !panel.querySelector(':scope > pre > code') ||
        !panel.querySelector(':scope > [onclick^="toggleFormattedCode("], :scope > pre > code.hljs')
      )
        continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui button';
      button.dataset.asterveil = 'copy-submission-code';
      button.textContent = '复制代码';
      button.setAttribute('aria-live', 'polite');
      panel.append(button);
    }
  };
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(mount);
  });
  observer.observe(container, { childList: true, subtree: true });
  container.addEventListener(
    'click',
    async (event) => {
      const button = event.target instanceof Element ? event.target.closest(selector) : null;
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      const code = button.parentElement?.querySelector(':scope > pre > code');
      if (!code) return;
      clearTimeout(resetTimer);
      if (activeButton && activeButton !== button) activeButton.textContent = '复制代码';
      activeButton = button;
      button.disabled = true;
      try {
        await copyText(code.textContent ?? '', scope.signal);
        if (!scope.signal.aborted) button.textContent = '已复制';
      } catch {
        if (!scope.signal.aborted) button.textContent = '复制失败';
      } finally {
        if (!scope.signal.aborted) {
          button.disabled = false;
          resetTimer = setTimeout(() => {
            button.textContent = '复制代码';
          }, 2000);
        }
      }
    },
    { signal: scope.signal },
  );
  scope.defer(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(resetTimer);
    for (const button of container.querySelectorAll(selector)) button.remove();
  });
  mount();
}
