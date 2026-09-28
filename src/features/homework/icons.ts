const paths = {
  bold: '<path d="M6 4h7a4 4 0 0 1 0 8H6Zm0 8h8a4 4 0 0 1 0 8H6Z"/>',
  italic: '<path d="M10 4h9M5 20h9M15 4 9 20"/>',
  strike: '<path d="M17 6c-1-2-8-3-10 1-1 2 1 4 5 5s6 3 5 5c-2 4-9 3-11 1M3 12h18"/>',
  rule: '<path d="M4 12h16"/>',
  heading: '<path d="M4 5v14M13 5v14M4 12h9M17 12l2-2v9m-2 0h4"/>',
  quote: '<path d="M4 6h6v7H4Zm10 0h6v7h-6ZM10 13c0 4-2 5-5 6m15-6c0 4-2 5-5 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6"/>',
  math: '<path d="M15 4c-3-2-5 0-5 3l-2 11c0 3-2 4-4 2M6 10h10m0 5 5 6m0-6-5 6"/>',
  link: '<path d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  table:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  ordered: '<path d="M10 6h11M10 12h11M10 18h11M3 4l2-1v6M3 9h4M3 14c0-3 4-3 4 0 0 2-4 3-4 6h4"/>',
  task: '<path d="M10 5H4v15h15v-8M8 10l4 4L21 4"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7 18 18 0 0 1-4 5M6 6a18 18 0 0 0-4 6s3 7 10 7c2 0 4-1 5-2M10 10a3 3 0 0 0 4 4"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  send: '<path d="m3 3 19 9-19 9 4-9Zm4 9h15"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
} as const;

export function icon(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export const formatTools = [
  ['bold', '加粗'],
  ['italic', '斜体'],
  ['strike', '删除线'],
  ['rule', '分隔线'],
  ['heading', '标题'],
  ['quote', '引用'],
  ['code', '代码'],
  ['math', '公式'],
  ['link', '链接'],
  ['image', '图片'],
  ['table', '表格'],
  ['list', '无序列表'],
  ['ordered', '有序列表'],
  ['task', '任务列表'],
] as const;

export function formatToolbar(): string {
  return formatTools
    .map(
      ([name, label], index) =>
        `${[4, 7, 9].includes(index) ? '<span class="separator" aria-hidden="true"></span>' : ''}<button type="button" class="icon-button" data-format="${name}" title="${label}" aria-label="${label}">${icon(name)}</button>`,
    )
    .join('');
}
