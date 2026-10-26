import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  advanceUserGrade,
  firstUserGradeAcademicYear,
  isUserGradeAcademicYear,
  userGradeAcademicYear,
} from '../src/shared/user-grade-year.ts';

const repository = 'https://github.com/DestinyleSnowy/Better-Names-for-7FA4';
const revision =
  process.argv[2] ??
  execFileSync('git', ['ls-remote', `${repository}.git`, 'refs/heads/main'], {
    encoding: 'utf8',
  }).split(/\s+/)[0];
if (!/^[a-f\d]{40}$/i.test(revision ?? '')) throw new Error('Expected an upstream commit SHA.');

const base = `https://raw.githubusercontent.com/DestinyleSnowy/Better-Names-for-7FA4/${revision}/Better-Names-for-7FA4/data/`;
const load = async (name) => {
  const response = await fetch(`${base}${name}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name}: expected an object`);
  return value;
};
const [database, special] = await Promise.all([load('users.json'), load('special_users.json')]);
const sourceAcademicYear = Number(
  process.argv[3] ?? database.academicYear ?? firstUserGradeAcademicYear,
);
if (!isUserGradeAcademicYear(sourceAcademicYear)) throw new Error('Invalid source academic year.');
if (database.__encrypted__ === true)
  throw new Error('Expected the public extension name database.');
const names = new Map();
const grades = new Map();
const add = (entries) => {
  for (const [id, record] of Object.entries(entries)) {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new Error(`Invalid user ID: ${id}`);
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error(`Invalid user record: ${id}`);
    if (record.name !== undefined && typeof record.name !== 'string')
      throw new Error(`Invalid name: ${id}`);
    const name = record.name?.trim() || names.get(id);
    if (!name) continue;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Names must be printable, single-line labels.
    if (name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) throw new Error(`Invalid name: ${id}`);
    names.set(id, name);
    const grade = record.colorKey ?? grades.get(id) ?? 'uk';
    if (
      typeof grade !== 'string' ||
      !/^(?:x[456]|c[123]|g[123]|d[1234]|by|jl|uk|clear)$/.test(grade)
    )
      throw new Error(`Invalid grade: ${id}`);
    grades.set(id, grade);
  }
};
add(database.users ?? database);
add(special.users ?? {});
if (!names.size) throw new Error('The upstream database contains no names.');
const directory = new URL('../src/data/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('user-names.json', directory),
  `${JSON.stringify(
    Object.fromEntries([...names].sort(([a], [b]) => Number(a) - Number(b))),
    null,
    2,
  )}\n`,
);
await writeFile(
  new URL('user-grades.json', directory),
  `${JSON.stringify(Object.fromEntries([...grades].sort(([a], [b]) => Number(a) - Number(b)).map(([id, grade]) => [id, advanceUserGrade(grade, sourceAcademicYear)])), null, 2)}\n`,
);
await writeFile(
  new URL('user-names.source.json', directory),
  `${JSON.stringify(
    {
      repository,
      revision,
      sourceAcademicYear,
      academicYear: userGradeAcademicYear,
      records: names.size,
      gradeRecords: grades.size,
      files: [
        'Better-Names-for-7FA4/data/users.json',
        'Better-Names-for-7FA4/data/special_users.json',
      ],
    },
    null,
    2,
  )}\n`,
);
console.log(`Updated ${names.size} local records from ${revision}. Encrypt before publishing.`);
