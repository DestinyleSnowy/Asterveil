import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked } from 'marked';

export function renderMarkdown(
  source: string,
  target: HTMLElement,
  options: { chat?: boolean } = {},
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
  target.innerHTML = DOMPurify.sanitize(markdown.parse(source, { async: false }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name'],
  });
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
