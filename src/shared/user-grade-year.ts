import type { UserGrade } from './user-name-palette';

export const userGradeAcademicYear = 2026;
export const firstUserGradeAcademicYear = 2025;
const progression: readonly UserGrade[] = [
  'x4',
  'x5',
  'x6',
  'c1',
  'c2',
  'c3',
  'g1',
  'g2',
  'g3',
  'd1',
  'd2',
  'd3',
  'd4',
  'by',
];

export const isUserGradeAcademicYear = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 2000 &&
  value <= userGradeAcademicYear;

export function advanceUserGrade(grade: UserGrade, fromYear: number): UserGrade {
  if (!isUserGradeAcademicYear(fromYear)) throw new Error('数据源学年无效');
  const index = progression.indexOf(grade);
  if (index < 0) return grade;
  return (
    progression[Math.min(index + userGradeAcademicYear - fromYear, progression.length - 1)] ?? grade
  );
}

export function cohortUserGrade(stage: string, entranceYear: number): UserGrade | undefined {
  if (
    !Number.isSafeInteger(entranceYear) ||
    entranceYear < 2000 ||
    entranceYear > userGradeAcademicYear
  )
    return;
  const start =
    stage === '小' ? -3 : stage === '初' ? 3 : stage === '高' ? 6 : stage === '大' ? 9 : undefined;
  if (start === undefined) return;
  const index = start + userGradeAcademicYear - entranceYear;
  if (index < 0) return;
  return progression[Math.min(index, progression.length - 1)];
}

export function graduateYearUserGrade(value: unknown): UserGrade {
  const year = typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : value;
  if (typeof year !== 'number' || !Number.isSafeInteger(year) || year < 1900 || year > 2100)
    return 'uk';
  const index = userGradeAcademicYear + 9 - year;
  return index < 0 ? 'uk' : (progression[Math.min(index, progression.length - 1)] ?? 'uk');
}

export function schoolClassUserGrade(value: string): UserGrade {
  const text = value.trim();
  const cohort = /^(小|初|高|大)(\d{4})级/.exec(text);
  if (cohort) return cohortUserGrade(cohort[1] ?? '', Number(cohort[2])) ?? 'uk';
  const school = /^(小学|初中|高中|大学|小|初|高|大)([一二三四五六1-6])/.exec(text);
  if (school) {
    const stage = school[1]?.[0];
    const number = school[2] ?? '';
    const year = /^\d$/.test(number) ? Number(number) : '一二三四五六'.indexOf(number) + 1;
    if (stage === '小' && year >= 4 && year <= 6) return `x${year}` as UserGrade;
    if (stage === '初' && year >= 1 && year <= 3) return `c${year}` as UserGrade;
    if (stage === '高' && year >= 1 && year <= 3) return `g${year}` as UserGrade;
    if (stage === '大' && year >= 1 && year <= 4) return `d${year}` as UserGrade;
  }
  if (/^毕业/.test(text)) return 'by';
  if (/^(教练|老师|教师)/.test(text)) return 'jl';
  return 'uk';
}
