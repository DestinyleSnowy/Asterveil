import { lexer } from 'marked';

export function problemDescription(source: string): string | undefined {
  const markdown = source.replace(/\r\n?/g, '\n');
  let offset = 0;
  let start: number | undefined;
  let depth = 0;
  let end = markdown.length;
  for (const token of lexer(markdown)) {
    const position = markdown.indexOf(token.raw, offset);
    if (position < 0) return undefined;
    offset = position + token.raw.length;
    if (token.type !== 'heading') continue;
    if (start !== undefined && token.depth <= depth) {
      end = position;
      break;
    }
    const title = token.text.replace(/<[^>]*>|[*_`]/g, '').trim();
    if (
      start === undefined &&
      /^(?:[【[]\s*)?(?:题目描述|问题描述|problem\s+description|description)(?:\s*[】\]])?$/i.test(
        title,
      )
    ) {
      start = offset;
      depth = token.depth;
    }
  }
  return start === undefined ? undefined : markdown.slice(start, end).trim() || undefined;
}
