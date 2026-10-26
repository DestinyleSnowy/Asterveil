import { graduateYearUserGrade } from './user-grade-year';
import type { UserNameEntry, UserNameRecord } from './user-name-sources';

export const maxBetterNamesPlanLength = 2 * 1024 * 1024;
export class BetterNamesPlanError extends Error {
  constructor(
    message: string,
    readonly clearCache = false,
  ) {
    super(message);
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseBetterNamesPlan(value: unknown): readonly UserNameEntry[] {
  if (object(value) && value.success === false)
    throw new BetterNamesPlanError('暂无访问权限', true);
  const users = Array.isArray(value) ? value : object(value) ? value.users : undefined;
  if (!Array.isArray(users) || users.length > 10_000)
    throw new BetterNamesPlanError('计划数据格式无效');
  return supplementalUserEntries(
    users.filter(object).map((user) => ({
      id: user.id ?? user.user_id,
      name: user.real_name,
      grade: graduateYearUserGrade(user.graduate_year),
    })),
  );
}

export function supplementalUserEntries(
  users: readonly { id: unknown; name: unknown; grade: UserNameEntry[2] }[],
): readonly UserNameEntry[] {
  const entries = new Map<string, UserNameEntry>();
  const ambiguous = new Set<string>();
  for (const user of users) {
    const rawId = user.id;
    if (
      (typeof rawId !== 'number' && typeof rawId !== 'string') ||
      (typeof rawId === 'string' && !/^\d+$/.test(rawId.trim())) ||
      !Number.isSafeInteger(Number(rawId)) ||
      Number(rawId) <= 0
    )
      continue;
    const id = String(Number(rawId));
    if (ambiguous.has(id) || typeof user.name !== 'string') continue;
    const name = user.name.trim().normalize('NFC');
    if (
      !name ||
      name.length > 128 ||
      [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      continue;
    const grade = user.grade ?? 'uk';
    const previous = entries.get(id);
    if (previous && (previous[1] !== name || previous[2] !== grade)) {
      entries.delete(id);
      ambiguous.add(id);
    } else entries.set(id, [id, name, grade]);
  }
  return [...entries.values()].sort(([a], [b]) => Number(a) - Number(b));
}

export function supplementUserRecords(
  database: ReadonlyMap<string, UserNameRecord>,
  entries: readonly UserNameEntry[],
): ReadonlyMap<string, UserNameRecord> {
  const records = new Map(database);
  for (const [id, name, grade] of entries) if (!records.has(id)) records.set(id, { name, grade });
  return records;
}

export interface BetterNamesPlanState {
  readonly entries: readonly UserNameEntry[];
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: string;
}
const emptyState = (): BetterNamesPlanState => ({
  entries: [],
  loaded: false,
  loading: false,
  error: '',
});

export function createBetterNamesPlanSource(
  load: (signal: AbortSignal) => Promise<readonly UserNameEntry[]>,
  context: () => string,
) {
  let key = context();
  let state = emptyState();
  const listeners = new Set<(value: BetterNamesPlanState) => void>();
  let request: { key: string; controller: AbortController; promise: Promise<void> } | undefined;
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  function checkContext(): boolean {
    const current = context();
    if (current === key) return false;
    key = current;
    request?.controller.abort();
    request = undefined;
    state = emptyState();
    emit();
    return true;
  }
  function refresh(force = false): Promise<void> {
    checkContext();
    if (request) return request.promise;
    if (!force && (state.loaded || state.error)) return Promise.resolve();
    const active = { key, controller: new AbortController(), promise: Promise.resolve() };
    request = active;
    state = { ...state, loading: true, error: '' };
    active.promise = Promise.resolve().then(async () => {
      try {
        if (request !== active || active.controller.signal.aborted) return;
        const incoming = await load(active.controller.signal);
        if (request !== active || active.controller.signal.aborted || checkContext()) return;
        const same =
          state.entries.length === incoming.length &&
          state.entries.every(
            (entry, index) =>
              entry.length === incoming[index]?.length &&
              entry.every((value, field) => value === incoming[index]?.[field]),
          );
        state = {
          entries: same ? state.entries : incoming,
          loaded: true,
          loading: false,
          error: '',
        };
      } catch (error) {
        if (request !== active || active.controller.signal.aborted || checkContext()) return;
        const known = error instanceof BetterNamesPlanError;
        state = {
          ...(known && error.clearCache ? emptyState() : state),
          loading: false,
          error: known ? error.message : '暂时无法更新',
        };
      } finally {
        if (request === active) {
          request = undefined;
          emit();
        }
      }
    });
    emit();
    return active.promise;
  }
  function cancel(): void {
    if (!request) return;
    request.controller.abort();
    request = undefined;
    state = { ...state, loading: false };
    emit();
  }
  return {
    checkContext,
    refresh,
    cancel,
    subscribe(listener: (value: BetterNamesPlanState) => void) {
      checkContext();
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) cancel();
      };
    },
  };
}
