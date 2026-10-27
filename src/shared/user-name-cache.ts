import { isUserGradeKey } from './user-name-palette';
import type { UserNameEntry } from './user-name-sources';

export const userNameCacheKey = 'asterveil:user-name-session-cache';
export const remoteUserNameSourceIds = ['official', 'plan', 'friends'] as const;
export type RemoteUserNameSourceId = (typeof remoteUserNameSourceIds)[number];
export const isRemoteUserNameSourceId = (value: unknown): value is RemoteUserNameSourceId =>
  remoteUserNameSourceIds.some((kind) => kind === value);

export interface UserNameCacheRecord {
  readonly entries: readonly UserNameEntry[];
  readonly savedAt: number;
  readonly password?: string;
}
export type UserNameCacheRecords = Partial<Record<RemoteUserNameSourceId, UserNameCacheRecord>>;
export type UserNameCacheCommand =
  | { action: 'connect'; account: number | null; token?: string | null }
  | {
      action: 'save';
      token: string;
      kind: RemoteUserNameSourceId;
      entries: readonly UserNameEntry[];
      password?: string;
    }
  | { action: 'discard'; token: string; kind: RemoteUserNameSourceId };
export type UserNameCacheRequest = {
  channel: 'asterveil';
  type: 'user-names.cache';
} & UserNameCacheCommand;
export interface UserNameCacheConnection {
  readonly ok: true;
  readonly token: string | null;
  readonly records: UserNameCacheRecords;
}
export type UserNameCacheResponse =
  | UserNameCacheConnection
  | { ok: false; error: string; clearCache: boolean };
export interface UserNameCacheNotice {
  readonly type: 'asterveil:user-names.cache-changed';
  readonly token: string;
  readonly kind?: RemoteUserNameSourceId;
  readonly record?: UserNameCacheRecord;
}

export function isUserNameCacheRequest(value: unknown): value is UserNameCacheRequest {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (raw.channel !== 'asterveil' || raw.type !== 'user-names.cache') return false;
  if (raw.action === 'connect')
    return (
      (raw.token === undefined ||
        raw.token === null ||
        (typeof raw.token === 'string' && raw.token.length <= 80)) &&
      (raw.account === null || (Number.isSafeInteger(raw.account) && Number(raw.account) > 0))
    );
  if (typeof raw.token !== 'string' || raw.token.length > 80 || !isRemoteUserNameSourceId(raw.kind))
    return false;
  if (raw.action === 'discard') return true;
  if (raw.action !== 'save' || !Array.isArray(raw.entries) || raw.entries.length > 10_000)
    return false;
  if (
    raw.password !== undefined &&
    (raw.kind !== 'official' ||
      typeof raw.password !== 'string' ||
      !raw.password ||
      raw.password.length > 4096)
  )
    return false;
  if (raw.kind === 'official' && typeof raw.password !== 'string') return false;
  const ids = new Set<string>();
  return raw.entries.every((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) return false;
    const [id, name, grade] = entry;
    if (
      typeof id !== 'string' ||
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      ids.has(id)
    )
      return false;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 128 ||
      [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      return false;
    if (grade !== undefined && grade !== 'clear' && !isUserGradeKey(grade)) return false;
    ids.add(id);
    return true;
  });
}

export const userNameCacheMaxAge = (kind: RemoteUserNameSourceId) =>
  kind === 'official' ? 30 * 60_000 : 5 * 60_000;
export const isUserNameCacheFresh = (
  kind: RemoteUserNameSourceId,
  savedAt: number,
  now = Date.now(),
) => savedAt <= now && now - savedAt < userNameCacheMaxAge(kind);
