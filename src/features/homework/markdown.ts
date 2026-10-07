import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked, type Token, type TokensList } from 'marked';

export interface MarkdownAnchor {
  offset: number;
  element: HTMLElement;
  bottom?: boolean;
}

export function renderMarkdown(
  source: string,
  target: HTMLElement,
  options: { chat?: boolean; anchors?: MarkdownAnchor[] } = {},
): void {
  const formulas: Array<{ text: string; displayMode: boolean }> = [];
  const marker = `av-math-${crypto.randomUUID()}`;
  const markdown = new Marked({ gfm: true, breaks: options.chat === true });
  markdown.use({ renderer: { checkbox: ({ checked }) => (checked ? '☑ ' : '☐ ') } });
  if (options.chat) {
    const escapeHtml = (text: string) =>
      text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    markdown.use({
      renderer: {
        html: ({ text }) => escapeHtml(text),
        // Chat messages must not silently load third-party tracking images.
        image: ({ href, text }) =>
          `<a href="${escapeHtml(href)}">${escapeHtml(text || '图片')}</a>`,
      },
    });
  }
  for (const [name, level, expression, displayMode, delimiter] of [
    ['blockMath', 'block', /^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/, true, '$$'],
    ['blockLatex', 'block', /^\\\[([\s\S]+?)\\\](?:\n|$)/, true, '\\['],
    ['inlineDisplayMath', 'inline', /^\$\$([\s\S]+?)\$\$/, true, '$$'],
    ['inlineDisplayLatex', 'inline', /^\\\[([\s\S]+?)\\\]/, true, '\\['],
    ['inlineMath', 'inline', /^\$([^$\n]+?)\$/, false, '$'],
    ['inlineLatex', 'inline', /^\\\(([^\n]+?)\\\)/, false, '\\('],
  ] as const) {
    markdown.use({
      extensions: [
        {
          name,
          level,
          start: (text) => text.indexOf(delimiter),
          tokenizer(text) {
            const match = expression.exec(text);
            if (match) return { type: name, raw: match[0], text: match[1] ?? '' };
          },
          renderer(token) {
            const index = formulas.push({ text: token.text, displayMode }) - 1;
            return `<span data-av-math="${marker}-${index}"></span>`;
          },
        },
      ],
    });
  }
  const blocks: { token: Token; offset: number; id: string }[] = [];
  let html: string;
  if (options.anchors) {
    const tokens = markdown.lexer(source);
    let offset = 0;
    html = tokens
      .map((token, index) => {
        const id = `${marker}-${index}`;
        blocks.push({ token, offset, id });
        offset += token.raw.length;
        const fragment = Object.assign([token], { links: tokens.links }) as TokensList;
        return `<div data-av-source="${id}">${markdown.parser(fragment)}</div>`;
      })
      .join('');
  } else html = markdown.parse(source, { async: false });
  target.innerHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name'],
  });
  if (options.anchors) {
    options.anchors.length = 0;
    for (const { token, offset, id } of blocks) {
      const wrapper = target.querySelector<HTMLElement>(`[data-av-source="${id}"]`);
      if (!wrapper) continue;
      const first = wrapper.firstElementChild as HTMLElement | null;
      const last = wrapper.lastElementChild as HTMLElement | null;
      if (first && last) {
        options.anchors.push({ offset, element: first });
        if (token.type === 'table') {
          const rows = [...first.querySelectorAll<HTMLElement>('tr')];
          let lineOffset = offset;
          token.raw.split('\n').forEach((line, index) => {
            // The delimiter row has no rendered counterpart.
            const row = index === 0 ? rows[0] : index > 1 ? rows[index - 1] : undefined;
            if (row) options.anchors?.push({ offset: lineOffset, element: row });
            lineOffset += line.length + 1;
          });
        } else if (token.type === 'list') {
          let itemOffset = 0;
          const items = [...first.children].filter((element) => element.tagName === 'LI');
          token.items.forEach((item: Token, index: number) => {
            const start = token.raw.indexOf(item.raw, itemOffset);
            if (start < 0) return;
            const element = items[index] as HTMLElement | undefined;
            if (element) options.anchors?.push({ offset: offset + start, element });
            itemOffset = start + item.raw.length;
          });
        }
        options.anchors.push({
          offset: offset + token.raw.trimEnd().length,
          element: last,
          bottom: true,
        });
      }
      wrapper.replaceWith(...wrapper.childNodes);
    }
  }
  // Sanitize user HTML first, then insert only KaTeX-generated layout. Its inline
  // metrics and SVG radicals must survive; user-supplied styles remain forbidden.
  formulas.forEach(({ text, displayMode }, index) => {
    const slot = target.querySelector<HTMLElement>(`[data-av-math="${marker}-${index}"]`);
    if (!slot) return;
    katex.render(text, slot, {
      displayMode,
      output: 'htmlAndMathml',
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
      maxSize: 20,
    });
    slot.removeAttribute('data-av-math');
  });
  for (const link of target.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  for (const image of target.querySelectorAll('img')) image.referrerPolicy = 'no-referrer';
}
