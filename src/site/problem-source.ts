import type { Scope } from '../core/scope';
import { copyText } from '../platform/clipboard';
import { defaultProblemCopySettings, type ProblemCopySettings } from '../shared/problem-copy';
import { problemDescription } from './problem-description';
import css from './problem-source.css?inline';

export function enhanceProblemSource(
  scope: Scope,
  url: URL,
  options: ProblemCopySettings = defaultProblemCopySettings(),
): void {
  const problemId = url.pathname.match(/\/problem\/(\d+)\/?$/)?.[1];
  if (!problemId) return;
  const sourceLink = [...document.querySelectorAll<HTMLAnchorElement>('a.ui.button[href]')].find(
    (link) => {
      const target = new URL(link.href, url);
      return (
        target.origin === url.origin &&
        [
          `/problem/${problemId}/markdown/html`,
          `${url.pathname.replace(/\/$/, '')}/markdown/html`,
        ].includes(target.pathname)
      );
    },
  );
  if (!sourceLink) return;

  const group = sourceLink.parentElement;
  if (group?.matches('.ui.buttons')) {
    const className = 'asterveil-problem-copy-actions';
    const existing = group.classList.contains(className);
    const style = document.createElement('style');
    style.textContent = css;
    group.classList.add(className);
    document.documentElement.append(style);
    scope.defer(() => {
      style.remove();
      if (!existing) group.classList.remove(className);
    });
  }

  if (options.hideOriginal) {
    const hidden = sourceLink.getAttribute('hidden');
    const display = sourceLink.style.getPropertyValue('display');
    const priority = sourceLink.style.getPropertyPriority('display');
    sourceLink.hidden = true;
    sourceLink.style.setProperty('display', 'none', 'important');
    scope.defer(() => {
      if (sourceLink.getAttribute('hidden') === '') {
        if (hidden === null) sourceLink.removeAttribute('hidden');
        else sourceLink.setAttribute('hidden', hidden);
      }
      if (
        sourceLink.style.getPropertyValue('display') === 'none' &&
        sourceLink.style.getPropertyPriority('display') === 'important'
      ) {
        if (display) sourceLink.style.setProperty('display', display, priority);
        else sourceLink.style.removeProperty('display');
      }
    });
  }

  let previous: Element = sourceLink;
  for (const kind of ['source', 'description'] as const) {
    if (!options[kind]) continue;
    const label = kind === 'source' ? '复制源码' : '复制题目描述';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small ui button';
    button.dataset.asterveil = `copy-problem-${kind}`;
    button.textContent = label;
    button.setAttribute('aria-live', 'polite');
    previous.after(button);
    previous = button;
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
          const markdown = source.textContent ?? '';
          const text = kind === 'source' ? markdown : problemDescription(markdown);
          if (text === undefined) throw new Error('未找到题目描述');
          if (scope.signal.aborted) return;
          await copyText(text, scope.signal);
          if (!scope.signal.aborted) button.textContent = '已复制';
        } catch (error) {
          if (!scope.signal.aborted)
            button.textContent =
              error instanceof Error && error.message === '未找到题目描述'
                ? error.message
                : '复制失败';
        } finally {
          if (!scope.signal.aborted) {
            button.disabled = false;
            resetTimer = setTimeout(() => {
              button.textContent = label;
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
}
