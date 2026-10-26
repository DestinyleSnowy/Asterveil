import {
  firstUserGradeAcademicYear,
  isUserGradeAcademicYear,
  userGradeAcademicYear,
} from './user-grade-year';
import {
  decodeUserGradePalette,
  defaultUserGradePalette,
  normalizeUserGrade,
  type UserGrade,
  type UserGradePalette,
  userGradeLabel,
} from './user-name-palette';

export const maxUserNameImportLength = 2 * 1024 * 1024;
export const maxUserNameSources = 10;
export const maxCustomUserNames = 10_000;
export const builtinUserNameSourceIds = ['official', 'plan', 'friends'] as const;
export type BuiltinUserNameSourceId = (typeof builtinUserNameSourceIds)[number];
export const isBuiltinUserNameSourceId = (value: unknown): value is BuiltinUserNameSourceId =>
  typeof value === 'string' && builtinUserNameSourceIds.some((id) => id === value);

export type UserNameEntry = readonly [id: string, name: string, grade?: UserGrade];
export interface UserNameRecord {
  readonly name: string;
  readonly grade?: UserGrade | undefined;
}
export interface UserNameSource {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly entries: readonly UserNameEntry[];
}
export interface UserNameSources {
  readonly revision: number;
  readonly academicYear: number;
  readonly builtin: Readonly<Record<BuiltinUserNameSourceId, boolean>>;
  readonly sources: readonly UserNameSource[];
  readonly palette: UserGradePalette;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isUserNameSourceId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const isUserNameSourceName = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && printable(value);

function printable(value: string): boolean {
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
}
function userId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (
    (typeof raw !== 'string' && typeof raw !== 'number') ||
    (typeof raw === 'string' && !/^\d+$/.test(raw)) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) <= 0
  )
    throw new Error(`无效的用户 ID：${String(value).slice(0, 40)}`);
  return String(Number(raw));
}
function userName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('姓名必须是文本');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 128 || !printable(name))
    throw new Error('姓名须为 1–128 个字符，且不能包含换行或控制字符');
  return name;
}
function addEntry(entries: Map<string, UserNameRecord>, id: string, record: UserNameRecord): void {
  const previous = entries.get(id);
  if (previous && previous.name !== record.name)
    throw new Error(`ID ${id} 的重复记录不一致：“${previous.name}” / “${record.name}”`);
  if (previous?.grade && record.grade && previous.grade !== record.grade)
    throw new Error(
      `ID ${id} 的年级不一致：${userGradeLabel(previous.grade)} / ${userGradeLabel(record.grade)}`,
    );
  entries.set(id, { name: record.name, grade: record.grade ?? previous?.grade });
  if (entries.size > maxCustomUserNames) throw new Error('自定义数据最多 10,000 条');
}
const sorted = (entries: ReadonlyMap<string, UserNameRecord>): readonly UserNameEntry[] =>
  [...entries]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, record]) => (record.grade ? [id, record.name, record.grade] : [id, record.name]));

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
class JsonObject {
  constructor(readonly fields: readonly (readonly [string, JsonValue])[]) {}
}

// Keep object members in order: JSON.parse alone silently loses duplicate user IDs.
function parseJson(text: string): JsonValue {
  let index = 0;
  let values = 0;
  const fail = (): never => {
    throw new Error(`JSON 格式无效，位置 ${index + 1}`);
  };
  const space = () => {
    while (index < text.length && ' \t\r\n'.includes(text[index] ?? '')) index++;
  };
  const string = (): string => {
    if (text[index] !== '"') return fail();
    const start = index++;
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          return fail();
        }
      }
      if (character === '\\') index++;
    }
    return fail();
  };
  const read = (depth: number): JsonValue => {
    if (depth > 12 || ++values > 60_000) throw new Error('JSON 结构过深或数据过多');
    space();
    if (text[index] === '"') return string();
    if (text[index] === '{') {
      index++;
      const fields: [string, JsonValue][] = [];
      space();
      if (text[index] === '}') {
        index++;
        return new JsonObject(fields);
      }
      while (index < text.length) {
        space();
        const key = string();
        space();
        if (text[index++] !== ':') return fail();
        fields.push([key, read(depth + 1)]);
        space();
        const next = text[index++];
        if (next === '}') return new JsonObject(fields);
        if (next !== ',') return fail();
      }
      return fail();
    }
    if (text[index] === '[') {
      index++;
      const items: JsonValue[] = [];
      space();
      if (text[index] === ']') {
        index++;
        return items;
      }
      while (index < text.length) {
        items.push(read(depth + 1));
        space();
        const next = text[index++];
        if (next === ']') return items;
        if (next !== ',') return fail();
      }
      return fail();
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(index),
    )?.[0];
    if (!token) return fail();
    index += token.length;
    return JSON.parse(token) as JsonValue;
  };
  const result = read(0);
  space();
  if (index !== text.length) return fail();
  return result;
}

export function parseUserNameSource(text: string): readonly UserNameEntry[] {
  if (typeof text !== 'string' || text.length > maxUserNameImportLength)
    throw new Error('数据文件不能超过 2 MB');
  const value = parseJson(text.replace(/^\uFEFF/, ''));
  const yearFields =
    value instanceof JsonObject ? value.fields.filter(([key]) => key === 'academicYear') : [];
  let academicYear: number = userGradeAcademicYear;
  if (yearFields.length) {
    const year = yearFields[0]?.[1];
    if (!isUserGradeAcademicYear(year) || yearFields.some(([, value]) => value !== year))
      throw new Error('数据源学年无效或不一致');
    academicYear = year;
  }
  const entries = new Map<string, UserNameRecord>();
  const nameField = (record: JsonObject): string => {
    const fields = record.fields
      .filter(([key]) => key === 'name')
      .map(([, name]) => userName(name));
    if (!fields.length) throw new Error('用户记录缺少 name');
    if (fields.some((name) => name !== fields[0])) throw new Error('同一记录的 name 不一致');
    return fields[0] as string;
  };
  const recordIds = (record: JsonObject) =>
    record.fields
      .filter(([key]) => ['id', 'user_id', 'uid'].includes(key))
      .map(([, id]) => userId(id));
  const recordValue = (record: JsonValue, id: string): UserNameRecord => {
    try {
      if (!(record instanceof JsonObject)) return { name: userName(record) };
      if (recordIds(record).some((value) => value !== id))
        throw new Error('记录内的用户 ID 不一致');
      const grades = record.fields
        .filter(([key]) => key === 'colorKey' || key === 'grade')
        .map(([, grade]) => normalizeUserGrade(grade, academicYear))
        .filter((grade) => grade !== undefined);
      if (grades.some((grade) => grade !== grades[0])) throw new Error('同一记录的年级不一致');
      return { name: nameField(record), grade: grades[0] };
    } catch (error) {
      throw new Error(`ID ${id}：${error instanceof Error ? error.message : '姓名无效'}`);
    }
  };
  const records = (input: JsonValue) => {
    if (input instanceof JsonObject) {
      for (const [key, record] of input.fields) {
        const id = userId(key);
        addEntry(entries, id, recordValue(record, id));
      }
    } else if (Array.isArray(input)) {
      for (const record of input) {
        if (!(record instanceof JsonObject)) throw new Error('列表中的用户记录必须是对象');
        const ids = recordIds(record);
        if (!ids.length) throw new Error('用户记录缺少 ID');
        if (ids.some((id) => id !== ids[0])) throw new Error('同一记录的用户 ID 不一致');
        addEntry(entries, ids[0] as string, recordValue(record, ids[0] as string));
      }
    } else throw new Error('数据源须为 JSON 对象或用户列表');
  };
  const wrapped =
    value instanceof JsonObject ? value.fields.filter(([key]) => key === 'users') : [];
  if (wrapped.length) {
    if (value instanceof JsonObject && value.fields.some(([key]) => /^\d+$/.test(key)))
      throw new Error('users 结构不能混合顶层用户 ID');
    for (const [, users] of wrapped) records(users);
  } else records(value);
  if (!entries.size) throw new Error('数据源没有有效的用户记录');
  return sorted(entries);
}

export function mergedUserRecords(
  official: ReadonlyMap<string, string>,
  sources: readonly UserNameSource[],
  officialGrades: ReadonlyMap<string, UserGrade> = new Map(),
): ReadonlyMap<string, UserNameRecord> {
  const names = new Map<string, UserNameRecord>(
    [...official].map(([id, name]) => [
      id,
      {
        name: userName(name),
        grade: officialGrades.get(id),
      },
    ]),
  );
  const origins = new Map([...names.keys()].map((id) => [id, '官方']));
  const gradeOrigins = new Map([...officialGrades.keys()].map((id) => [id, '官方']));
  for (const source of sources)
    for (const [id, name, grade] of source.entries) {
      const previous = names.get(id);
      if (previous && previous.name !== name)
        throw new Error(
          `ID ${id} 冲突：${origins.get(id)}“${previous.name}” / ${source.name}“${name}”`,
        );
      if (previous?.grade && grade && previous.grade !== grade)
        throw new Error(
          `ID ${id} 年级冲突：${gradeOrigins.get(id)}“${userGradeLabel(previous.grade)}” / ${source.name}“${userGradeLabel(grade)}”`,
        );
      names.set(id, { name, grade: previous?.grade ?? grade });
      if (!previous?.grade && grade) gradeOrigins.set(id, source.name);
      if (previous === undefined) {
        origins.set(id, source.name);
      }
    }
  return names;
}

export function mergedUserNames(
  official: ReadonlyMap<string, string>,
  sources: readonly UserNameSource[],
  officialGrades: ReadonlyMap<string, UserGrade> = new Map(),
): ReadonlyMap<string, string> {
  return new Map(
    [...mergedUserRecords(official, sources, officialGrades)].map(([id, record]) => [
      id,
      record.name,
    ]),
  );
}

export function defaultUserNameSources(): UserNameSources {
  return {
    revision: 0,
    academicYear: userGradeAcademicYear,
    builtin: { official: true, plan: true, friends: true },
    sources: [],
    palette: defaultUserGradePalette(),
  };
}
export function decodeUserNameSources(value: unknown): UserNameSources {
  if (value === undefined) return defaultUserNameSources();
  if (
    !object(value) ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.revision !== 'number' ||
    value.revision < 0 ||
    !Array.isArray(value.sources) ||
    value.sources.length > maxUserNameSources
  )
    throw new Error('数据源设置无效');
  const academicYear =
    value.academicYear === undefined ? firstUserGradeAcademicYear : value.academicYear;
  if (!isUserGradeAcademicYear(academicYear)) throw new Error('数据源学年无效');
  const builtin = { ...defaultUserNameSources().builtin };
  if (value.builtin !== undefined) {
    if (!object(value.builtin)) throw new Error('数据源开关无效');
    for (const id of builtinUserNameSourceIds) {
      const enabled = value.builtin[id];
      if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('数据源开关无效');
      if (typeof enabled === 'boolean') builtin[id] = enabled;
    }
  }
  let upgraded = false;
  const ids = new Set<string>();
  let count = 0;
  const sources = value.sources.map((source: unknown): UserNameSource => {
    if (
      !object(source) ||
      !isUserNameSourceId(source.id) ||
      ids.has(source.id) ||
      !isUserNameSourceName(source.name) ||
      (source.enabled !== undefined && typeof source.enabled !== 'boolean') ||
      !Array.isArray(source.entries) ||
      !source.entries.length ||
      source.entries.length > maxCustomUserNames
    )
      throw new Error('自定义数据源无效');
    ids.add(source.id);
    const entries = new Map<string, UserNameRecord>();
    for (const entry of source.entries) {
      if (!Array.isArray(entry) || (entry.length !== 2 && entry.length !== 3))
        throw new Error('数据源记录无效');
      const grade = normalizeUserGrade(entry[2], academicYear);
      if (grade !== entry[2]) upgraded = true;
      addEntry(entries, userId(entry[0]), {
        name: userName(entry[1]),
        grade,
      });
    }
    count += entries.size;
    return {
      id: source.id,
      name: source.name.trim(),
      enabled: source.enabled !== false,
      entries: sorted(entries),
    };
  });
  if (count > maxCustomUserNames) throw new Error('自定义数据最多 10,000 条');
  mergedUserNames(new Map(), sources);
  return {
    revision: value.revision + Number(upgraded),
    academicYear: userGradeAcademicYear,
    builtin,
    sources,
    palette: decodeUserGradePalette(value.palette),
  };
}

export function importUserNameSource(
  current: UserNameSources,
  name: string,
  text: string,
  official: ReadonlyMap<string, string>,
  officialGrades: ReadonlyMap<string, UserGrade> = new Map(),
): UserNameSources {
  if (!isUserNameSourceName(name)) throw new Error('数据源名称须为 1–80 个字符');
  const entries = parseUserNameSource(text);
  const candidate = { id: '', name: name.trim(), enabled: true, entries };
  mergedUserRecords(official, [...current.sources, candidate], officialGrades);
  if (
    current.sources.some(
      (source) =>
        source.entries.length === entries.length &&
        source.entries.every(
          ([id, value, grade], index) =>
            id === entries[index]?.[0] &&
            value === entries[index]?.[1] &&
            grade === entries[index]?.[2],
        ),
    )
  )
    return current;
  if (current.sources.length >= maxUserNameSources) throw new Error('最多导入 10 个数据源');
  if (
    current.sources.reduce((count, source) => count + source.entries.length, entries.length) >
    maxCustomUserNames
  )
    throw new Error('自定义数据最多 10,000 条');
  const usedNames = new Set(current.sources.map((source) => source.name));
  let suffix = 2;
  while (usedNames.has(candidate.name))
    candidate.name = `${name.trim().slice(0, 72)} (${suffix++})`;
  return {
    ...current,
    revision: current.revision + 1,
    sources: [...current.sources, { ...candidate, id: crypto.randomUUID() }],
  };
}

export function removeUserNameSource(current: UserNameSources, id: string): UserNameSources {
  if (!isUserNameSourceId(id)) throw new Error('只能移除自定义数据源');
  const sources = current.sources.filter((source) => source.id !== id);
  return sources.length === current.sources.length
    ? current
    : { ...current, revision: current.revision + 1, sources };
}

export function activeUserNameRecords(
  official: ReadonlyMap<string, string>,
  current: UserNameSources,
  officialGrades: ReadonlyMap<string, UserGrade> = new Map(),
): ReadonlyMap<string, UserNameRecord> {
  return mergedUserRecords(
    current.builtin.official ? official : new Map(),
    current.sources.filter((source) => source.enabled),
    current.builtin.official ? officialGrades : new Map(),
  );
}

export function setUserNameSourceEnabled(
  current: UserNameSources,
  id: string,
  enabled: boolean,
  official: ReadonlyMap<string, string>,
  officialGrades: ReadonlyMap<string, UserGrade> = new Map(),
): UserNameSources {
  let next: UserNameSources;
  if (isBuiltinUserNameSourceId(id)) {
    if (current.builtin[id] === enabled) return current;
    next = { ...current, builtin: { ...current.builtin, [id]: enabled } };
  } else {
    const source = current.sources.find((source) => source.id === id);
    if (!source) throw new Error('数据源不存在');
    if (source.enabled === enabled) return current;
    next = {
      ...current,
      sources: current.sources.map((source) =>
        source.id === id ? { ...source, enabled } : source,
      ),
    };
  }
  activeUserNameRecords(official, next, officialGrades);
  return { ...next, revision: current.revision + 1 };
}
