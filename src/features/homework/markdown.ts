import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked } from 'marked';

export function renderMarkdown(source: string, target: HTMLElement): void {
  const formulas: Array<{ text: string; displayMode: boolean }> = [];
  const marker = `av-math-${crypto.randomUUID()}`;
  const markdown = new Marked({ gfm: true, breaks: false });
  markdown.use({ renderer: { checkbox: ({ checked }) => (checked ? '☑ ' : '☐ ') } });
  for (const [name, level, expression, displayMode] of [
    ['blockMath', 'block', /^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/, true],
    ['inlineMath', 'inline', /^\$([^$\n]+?)\$/, false],
  ] as const) {
    markdown.use({
      extensions: [
        {
          name,
          level,
          start: (text) => text.indexOf(displayMode ? '$$' : '$'),
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
