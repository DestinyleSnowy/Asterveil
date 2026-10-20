import type { Scope } from '../../core/scope';
import { icon } from './icons';

function tool(action: string, label: string, content: string, attributes = ''): string {
  return `<span class="search-tool"><button type="button" class="icon-button" data-search="${action}" aria-label="${label}" aria-describedby="search-tip-${action}" ${attributes}>${content}</button><span class="search-tooltip" role="tooltip" id="search-tip-${action}">${label}</span></span>`;
}

export function searchToggle(): string {
  return tool(
    'open',
    '查找与替换 (Ctrl+F)',
    icon('search'),
    'aria-expanded="false" aria-controls="editor-search"',
  );
}

export function searchMarkup(): string {
  return `<section id="editor-search" class="search-panel" aria-label="查找与替换" hidden>
    <div class="search-row">
      <input type="text" data-search-input="query" aria-label="查找" placeholder="查找" autocomplete="off" spellcheck="false">
      <span class="search-count" role="status" aria-live="polite" aria-atomic="true">0/0</span>
      <div class="search-controls">
        ${tool('case', '区分大小写', 'Aa', 'aria-pressed="false"')}
        ${tool('previous', '上一个 (Shift+Enter)', icon('up'))}
        ${tool('next', '下一个 (Enter)', icon('down'))}
        ${tool('close', '关闭查找 (Esc)', icon('close'))}
      </div>
    </div>
    <div class="search-row">
      <input type="text" data-search-input="replacement" aria-label="替换为" placeholder="替换为" autocomplete="off" spellcheck="false">
      <div class="search-controls"><button type="button" data-search="replace">替换</button><button type="button" data-search="replace-all">全部替换</button></div>
    </div>
    <span class="search-error" role="status" aria-live="polite"></span>
  </section>`;
}

export function createSearch(root: ShadowRoot, editor: HTMLTextAreaElement, scope: Scope): void {
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector) as T;
  const panel = get<HTMLElement>('.search-panel');
  const query = get<HTMLInputElement>('[data-search-input="query"]');
  const replacement = get<HTMLInputElement>('[data-search-input="replacement"]');
  const count = get<HTMLElement>('.search-count');
  const error = get<HTMLElement>('.search-error');
  const toggle = get<HTMLButtonElement>('[data-search="open"]');
  const caseButton = get<HTMLButtonElement>('[data-search="case"]');
  let matches: { start: number; end: number }[] = [];
  let current = -1;
  let caseSensitive = false;
  let editing = false;
  const highlight = document.createElement('div');
  highlight.className = 'search-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  highlight.hidden = true;
  const mirror = document.createElement('div');
  const mark = document.createElement('mark');
  highlight.append(mirror);
  editor.before(highlight);

  const syncHighlight = () => {
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  };
  const updateHighlight = () => {
    const match = matches[current];
    const visible = !panel.hidden && !!match;
    highlight.hidden = !visible;
    editor.classList.toggle('searching', visible);
    if (!visible || !match) return;
    const style = getComputedStyle(editor);
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'font-stretch',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'text-indent',
      'text-transform',
      'tab-size',
      'white-space',
      'overflow-wrap',
      'word-break',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ])
      mirror.style.setProperty(property, style.getPropertyValue(property));
    mirror.style.width = `${editor.clientWidth}px`;
    mark.textContent = editor.value.slice(match.start, match.end);
    mirror.replaceChildren(
      document.createTextNode(editor.value.slice(0, match.start)),
      mark,
      document.createTextNode(`${editor.value.slice(match.end)}\n`),
    );
    syncHighlight();
  };

  const updateControls = () => {
    count.textContent = `${current + 1}/${matches.length}`;
    count.setAttribute('aria-label', `第 ${current + 1} 项，共 ${matches.length} 项`);
    for (const action of ['previous', 'next', 'replace', 'replace-all']) {
      get<HTMLButtonElement>(`[data-search="${action}"]`).disabled =
        !matches.length || (action.startsWith('replace') && (editor.readOnly || editor.disabled));
    }
  };
  const reveal = () => {
    const match = matches[current];
    if (!match) return;
    editor.setSelectionRange(match.start, match.end);
    // Keep focus in the search field while exposing the match at its actual
    // wrapped position. The mirror also highlights an unfocused textarea.
    updateHighlight();
    const bounds = mark.getBoundingClientRect();
    const top = bounds.top - highlight.getBoundingClientRect().top + highlight.scrollTop;
    if (top < editor.scrollTop || top + bounds.height > editor.scrollTop + editor.clientHeight)
      editor.scrollTop = Math.max(0, top - editor.clientHeight / 2);
    syncHighlight();
  };
  const refresh = (offset = editor.selectionStart, select = true) => {
    error.textContent = '';
    const literal = query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    matches = literal
      ? Array.from(
          editor.value.matchAll(new RegExp(literal, caseSensitive ? 'gu' : 'giu')),
          (match) => ({
            start: match.index,
            end: match.index + match[0].length,
          }),
        )
      : [];
    current = matches.findIndex((match) => match.start >= offset);
    if (current < 0 && matches.length) current = 0;
    updateControls();
    if (select && matches.length) reveal();
    else updateHighlight();
  };
  const open = (replace = false) => {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if ((panel.hidden || root.activeElement === editor) && selected && !/[\r\n]/.test(selected))
      query.value = selected;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    refresh();
    const input = replace ? replacement : query;
    input.focus();
    input.select();
  };
  const close = () => {
    panel.hidden = true;
    updateHighlight();
    toggle.setAttribute('aria-expanded', 'false');
    editor.focus({ preventScroll: true });
  };
  const navigate = (direction: number) => {
    if (!matches.length) return;
    current = (current + direction + matches.length) % matches.length;
    updateControls();
    reveal();
  };
  const replace = (all: boolean) => {
    if (editor.readOnly || editor.disabled) return;
    const active = matches[current];
    const first = all ? matches[0] : active;
    const last = all ? matches[matches.length - 1] : active;
    if (!first || !last) return;
    const value = editor.value;
    const selected = all ? matches : [first];
    const nextLength = selected.reduce(
      (length, match) => length + replacement.value.length - (match.end - match.start),
      value.length,
    );
    if (editor.maxLength >= 0 && nextLength > editor.maxLength) {
      error.textContent = `替换后超过 ${editor.maxLength} 字符上限。`;
      return;
    }
    const parts: string[] = [];
    let offset = first.start;
    for (const match of selected) {
      parts.push(value.slice(offset, match.start), replacement.value);
      offset = match.end;
    }
    const text = parts.join('');
    const focus = root.activeElement as HTMLElement | null;
    editing = true;
    try {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(first.start, last.end);
      // Chromium's editing command preserves native Ctrl+Z / Ctrl+Y history.
      const changed = document.execCommand(text ? 'insertText' : 'delete', false, text);
      if (!changed) {
        editor.setRangeText(text, first.start, last.end, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    } finally {
      editing = false;
    }
    refresh(all ? first.start : first.start + text.length);
    focus?.focus({ preventScroll: true });
  };
  root.addEventListener(
    'click',
    (event) => {
      const action = (event.target as Element).closest<HTMLElement>('[data-search]')?.dataset
        .search;
      if (action === 'open') open();
      else if (action === 'close') close();
      else if (action === 'next') navigate(1);
      else if (action === 'previous') navigate(-1);
      else if (action === 'replace' || action === 'replace-all') replace(action === 'replace-all');
      else if (action === 'case') {
        caseSensitive = !caseSensitive;
        caseButton.setAttribute('aria-pressed', String(caseSensitive));
        refresh();
      }
    },
    { signal: scope.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const key = event as KeyboardEvent;
      if (key.isComposing || key.defaultPrevented) return;
      const shortcut = key.key.toLowerCase();
      if (
        (key.ctrlKey || key.metaKey) &&
        !key.altKey &&
        !key.shiftKey &&
        ['f', 'h'].includes(shortcut)
      ) {
        key.preventDefault();
        key.stopPropagation();
        open(shortcut === 'h');
      } else if (!panel.hidden && key.key === 'Escape') {
        key.preventDefault();
        key.stopPropagation();
        close();
      } else if (
        !panel.hidden &&
        key.key === 'Enter' &&
        (event.target === query || event.target === replacement)
      ) {
        key.preventDefault();
        if (event.target === replacement) replace(false);
        else navigate(key.shiftKey ? -1 : 1);
      }
    },
    { signal: scope.signal },
  );
  query.addEventListener('input', () => refresh(), { signal: scope.signal });
  editor.addEventListener(
    'input',
    () => {
      if (!panel.hidden && !editing) refresh(editor.selectionStart, false);
    },
    { signal: scope.signal },
  );
  const observer = new MutationObserver(updateControls);
  observer.observe(editor, { attributes: true, attributeFilter: ['readonly', 'disabled'] });
  editor.addEventListener('scroll', syncHighlight, { passive: true, signal: scope.signal });
  const resize = new ResizeObserver(updateHighlight);
  resize.observe(editor);
  document.fonts.addEventListener('loadingdone', updateHighlight, { signal: scope.signal });
  scope.defer(() => {
    observer.disconnect();
    resize.disconnect();
    highlight.remove();
    editor.classList.remove('searching');
  });
  updateControls();
}
