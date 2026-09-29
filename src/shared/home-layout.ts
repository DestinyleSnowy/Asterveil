export const homeSections = [
  { id: 'today', title: '今日计划', column: 'main' },
  { id: 'recent', title: '近期表现', column: 'main' },
  { id: 'best', title: '最好表现', column: 'main' },
  { id: 'notifications', title: '通知信息', column: 'side' },
  { id: 'progress', title: '学习进度', column: 'side' },
  { id: 'birthdays', title: '生日快乐', column: 'side' },
  { id: 'timer', title: '计时器', column: 'side' },
  { id: 'reviewable', title: '可批阅习题', column: 'side' },
  { id: 'daily', title: '我的日报', column: 'side' },
  { id: 'reviewed', title: '已批阅习题', column: 'side' },
  { id: 'announcements', title: '公告', column: 'side' },
  { id: 'links', title: '友情链接', column: 'side' },
] as const;

export type HomeSectionId = (typeof homeSections)[number]['id'];
export type HomeColumn = 'main' | 'side';
export interface HomeSection {
  readonly id: HomeSectionId;
  readonly column: HomeColumn;
  readonly visible: boolean;
}
export type HomeLayout = readonly HomeSection[];

export function isHomeSectionId(value: unknown): value is HomeSectionId {
  return homeSections.some((section) => section.id === value);
}

export function isHomeColumn(value: unknown): value is HomeColumn {
  return value === 'main' || value === 'side';
}

export function defaultHomeLayout(): HomeLayout {
  return homeSections.map(({ id, column }) => ({ id, column, visible: true }));
}

export function decodeHomeLayout(value: unknown): HomeLayout {
  if (value === undefined) return defaultHomeLayout();
  if (!Array.isArray(value) || value.length > homeSections.length)
    throw new Error('首页布局数据无效。');
  const seen = new Set<HomeSectionId>();
  const result: HomeSection[] = [];
  for (const item of value) {
    if (
      !item ||
      !isHomeSectionId(item.id) ||
      !isHomeColumn(item.column) ||
      typeof item.visible !== 'boolean' ||
      seen.has(item.id)
    )
      throw new Error('首页布局数据无效。');
    seen.add(item.id);
    result.push({ id: item.id, column: item.column, visible: item.visible });
  }
  return [...result, ...defaultHomeLayout().filter((item) => !seen.has(item.id))];
}

export function moveHomeSection(
  layout: HomeLayout,
  id: HomeSectionId,
  column: HomeColumn,
  before: HomeSectionId | null,
): HomeLayout {
  if (id === before) return layout;
  const section = layout.find((item) => item.id === id);
  if (!section) return layout;
  const result = layout.filter((item) => item.id !== id);
  const index = result.findIndex((item) => item.id === before && item.column === column);
  result.splice(index < 0 ? result.length : index, 0, { ...section, column });
  return result;
}
