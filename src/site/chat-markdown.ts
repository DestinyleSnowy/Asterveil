import { fontCss, layoutCss } from 'virtual:homework-katex';
import type { Scope } from '../core/scope';
import { renderMarkdown } from '../features/homework/markdown';
import markdownCss from '../features/homework/markdown.css?inline';

export function enhanceChatMarkdown(scope: Scope): void {
  const messages = document.querySelector<HTMLElement>('#chat-messages');
  if (!messages || scope.signal.aborted) return;
  const fonts = document.createElement('style');
  fonts.dataset.asterveil = 'chat-fonts';
  fonts.textContent = fontCss;
  document.head.append(fonts);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${layoutCss}\n${markdownCss}\n
    :host { display: block; min-width: 0; white-space: normal; }
    .paper { padding: 0; min-height: 0; background: transparent; font-size: 14px; }
    .paper > :last-child { margin-bottom: 0; }
    .paper h1 { font-size: 22px; } .paper h2 { font-size: 19px; }
    .paper h3 { font-size: 16px; }
    .paper pre { white-space: pre; overflow: auto; }
    .paper table { table-layout: auto; }
    .paper ul, .paper ol { padding-left: 1.6em; }
  `);
  const rendered = new Map<HTMLElement, { host: HTMLElement; original: DocumentFragment }>();
  const cache = new Map<string, string>();
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(update);
  });
  function update() {
    frame = 0;
    if (scope.signal.aborted || !messages) return;
    observer.disconnect();
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
    try {
      for (const [content, entry] of rendered) {
        if (!messages.contains(content) || entry.host.parentNode !== content) {
          if (entry.host.parentNode === content) content.replaceChildren(entry.original);
          rendered.delete(content);
          content.removeAttribute('data-asterveil-chat-markdown');
        }
      }
      for (const content of messages.querySelectorAll<HTMLElement>('.chat-message-content')) {
        if (rendered.has(content) || content.childElementCount) continue;
        const source = content.textContent ?? '';
        if (!source.trim() || source.length > 20000) continue;
        let html = cache.get(source);
        if (html === undefined) {
          const oldest = cache.keys().next().value;
          if (cache.size >= 100 && oldest !== undefined) cache.delete(oldest);
          const paper = document.createElement('article');
          try {
            renderMarkdown(source, paper, { chat: true });
          } catch {
            // An unusually complex message must not stop later messages rendering.
            cache.set(source, '');
            continue;
          }
          // Leave ordinary chat text in its native bubble, including line breaks.
          const plain = [...paper.querySelectorAll('*')].every((node) =>
            ['P', 'BR'].includes(node.tagName),
          );
          html = plain ? '' : paper.innerHTML;
          cache.set(source, html);
        }
        if (!html) continue;
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.adoptedStyleSheets = [sheet];
        const paper = document.createElement('article');
        paper.className = 'paper';
        // Only sanitized output from the shared renderer enters the shadow root.
        paper.innerHTML = html;
        shadow.append(paper);
        const original = document.createDocumentFragment();
        original.append(...content.childNodes);
        content.append(host);
        content.dataset.asterveilChatMarkdown = '';
        rendered.set(content, { host, original });
      }
      if (atBottom) messages.scrollTop = messages.scrollHeight;
    } finally {
      observer.observe(messages, { childList: true, subtree: true, characterData: true });
    }
  }
  scope.defer(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const [content, { host, original }] of rendered) {
      if (host.parentNode === content) content.replaceChildren(original);
      content.removeAttribute('data-asterveil-chat-markdown');
    }
    rendered.clear();
    cache.clear();
    fonts.remove();
  });
  update();
}
