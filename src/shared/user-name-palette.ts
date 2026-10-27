import { isAccentColor } from './palette';
import { advanceUserGrade, cohortUserGrade, userGradeAcademicYear } from './user-grade-year';

export const userGradeDefinitions = [
  { key: 'x4', label: `小${userGradeAcademicYear - 3}级`, color: '#96328c' },
  { key: 'x5', label: `小${userGradeAcademicYear - 4}级`, color: '#7d2ed1' },
  { key: 'x6', label: `小${userGradeAcademicYear - 5}级`, color: '#6400ff' },
  { key: 'c1', label: `初${userGradeAcademicYear}级`, color: '#ff4d4f' },
  { key: 'c2', label: `初${userGradeAcademicYear - 1}级`, color: '#ff7214' },
  { key: 'c3', label: `初${userGradeAcademicYear - 2}级`, color: '#ffaa00' },
  { key: 'g1', label: `高${userGradeAcademicYear}级`, color: '#96cc00' },
  { key: 'g2', label: `高${userGradeAcademicYear - 1}级`, color: '#44cc00' },
  { key: 'g3', label: `高${userGradeAcademicYear - 2}级`, color: '#146115' },
  { key: 'd1', label: `大${userGradeAcademicYear}级`, color: '#0033ff' },
  { key: 'd2', label: `大${userGradeAcademicYear - 1}级`, color: '#597ef7' },
  { key: 'd3', label: `大${userGradeAcademicYear - 2}级`, color: '#28a4bd' },
  { key: 'd4', label: `大${userGradeAcademicYear - 3}级`, color: '#70dbff' },
  { key: 'by', label: '毕业', color: '#8c8c8c' },
  { key: 'jl', label: '教练', color: '#ff85c0' },
  { key: 'uk', label: '其他', color: '#000000' },
] as const;

export type UserGradeKey = (typeof userGradeDefinitions)[number]['key'];
export type UserGrade = UserGradeKey | 'clear';
export const userGradeGroups: readonly { label: string; keys: readonly UserGradeKey[] }[] = [
  { label: '小学', keys: ['x4', 'x5', 'x6'] },
  { label: '初中', keys: ['c1', 'c2', 'c3'] },
  { label: '高中', keys: ['g1', 'g2', 'g3'] },
  { label: '大学', keys: ['d1', 'd2', 'd3', 'd4'] },
  { label: '其他', keys: ['by', 'jl', 'uk'] },
];
export type UserGradePaletteMode = 'default' | 'classic' | 'custom';
export interface UserGradePalette {
  readonly mode: UserGradePaletteMode;
  readonly colors: Readonly<Record<UserGradeKey, string>>;
}
export const classicUserGradeColors: Readonly<Record<UserGradeKey, string>> = {
  x4: '#8c8c8c',
  x5: '#722ed1',
  x6: '#9254de',
  c1: '#ff4d4f',
  c2: '#fa8c16',
  c3: '#faad14',
  g1: '#ca00ca',
  g2: '#52c41a',
  g3: '#13c2c2',
  d1: '#9254de',
  d2: '#597ef7',
  d3: '#73d13d',
  d4: '#bfbfbf',
  by: '#8c8c8c',
  jl: '#ff85c0',
  uk: '#5e6e5e',
};
// Classic colors belong to the 2025 cohorts, including students promoted to a new school stage.
const classicCohortColors = new Map<UserGrade, string>(
  userGradeDefinitions.map(({ key }) => [advanceUserGrade(key, 2025), classicUserGradeColors[key]]),
);
const labels = new Map<string, UserGradeKey>(
  userGradeDefinitions.map(({ key, label }) => [label, key]),
);
const previousDefaultPalettes = [
  userGradeDefinitions.map(({ key }) => classicUserGradeColors[key]),
  [
    '#8b6da8',
    '#785b97',
    '#654b83',
    '#4f80ad',
    '#3f6e9b',
    '#315c87',
    '#428775',
    '#327462',
    '#266150',
    '#ac804e',
    '#9b6e40',
    '#895d36',
    '#774f30',
    '#7b8594',
    '#ad637d',
    '#687584',
  ],
];
export const isUserGradeKey = (value: unknown): value is UserGradeKey =>
  userGradeDefinitions.some(({ key }) => key === value);
export const isUserGradePaletteMode = (value: unknown): value is UserGradePaletteMode =>
  value === 'default' || value === 'classic' || value === 'custom';

export function normalizeUserGrade(
  value: unknown,
  academicYear = userGradeAcademicYear,
): UserGrade | undefined {
  if (value === undefined || value === null || value === '') return;
  if (typeof value === 'string') {
    const key = value.trim();
    if (!key) return;
    if (key === 'clear' || isUserGradeKey(key)) return advanceUserGrade(key, academicYear);
    const grade = labels.get(key);
    if (grade) return grade;
    const cohort = /^([小初高大])(20\d{2})级$/.exec(key);
    const advanced = cohort && cohortUserGrade(cohort[1] ?? '', Number(cohort[2]));
    if (advanced) return advanced;
  }
  throw new Error(`无效的年级：${String(value).slice(0, 40)}`);
}
export function userGradeLabel(key: UserGrade): string {
  return userGradeDefinitions.find((grade) => grade.key === key)?.label ?? '原站配色';
}
export function defaultUserGradePalette(): UserGradePalette {
  return {
    mode: 'default',
    colors: Object.fromEntries(
      userGradeDefinitions.map(({ key, color }) => [key, color]),
    ) as Record<UserGradeKey, string>,
  };
}
export function decodeUserGradePalette(value: unknown): UserGradePalette {
  if (value === undefined) return defaultUserGradePalette();
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('年级配色设置无效');
  const raw = value as Record<string, unknown>;
  if (
    !isUserGradePaletteMode(raw.mode) ||
    typeof raw.colors !== 'object' ||
    raw.colors === null ||
    Array.isArray(raw.colors)
  )
    throw new Error('年级配色设置无效');
  const colors = { ...defaultUserGradePalette().colors };
  for (const [key, color] of Object.entries(raw.colors)) {
    if (!isUserGradeKey(key) || !isAccentColor(color)) throw new Error('年级颜色无效');
    colors[key] = color.toLowerCase();
  }
  // Adopt the current baseline only for an untouched legacy default palette.
  if (
    raw.mode === 'default' &&
    previousDefaultPalettes.some((previous) =>
      userGradeDefinitions.every(({ key }, index) => colors[key] === previous[index]),
    )
  )
    return defaultUserGradePalette();
  return { mode: raw.mode, colors };
}
export function userGradeColor(key: UserGrade, palette: UserGradePalette): string | undefined {
  if (key === 'clear') return;
  if (palette.mode === 'classic') return classicCohortColors.get(key) ?? classicUserGradeColors.uk;
  return palette.mode === 'custom'
    ? palette.colors[key]
    : userGradeDefinitions.find((grade) => grade.key === key)?.color;
}
