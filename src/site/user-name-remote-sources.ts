import type { Scope } from '../core/scope';
import {
  BetterNamesPlanError,
  type BetterNamesPlanState,
  createBetterNamesPlanSource,
  maxBetterNamesPlanLength,
  parseBetterNamesPlan,
} from '../shared/better-names-plan';
import { decryptOfficialUserNames, userNameEntryDatabase } from '../shared/user-name-database';
import { currentUserId } from './current-user';
import { parseFriendUserNames } from './friend-user-names';
import { officialUserNamePassword } from './official-user-name-password';
import { resolveSite } from './target';

export const remoteUserNameSourceIds = ['official', 'plan', 'friends'] as const;
export type RemoteUserNameSourceId = (typeof remoteUserNameSourceIds)[number];
const sources = new Map<RemoteUserNameSourceId, ReturnType<typeof createBetterNamesPlanSource>>();
const automatic: Record<RemoteUserNameSourceId, number> = { official: 0, plan: 0, friends: 0 };
let officialAccess: { context: string; password: string } | undefined;
const accountContext = () => `${location.origin}:${currentUserId() ?? 'guest'}`;
let observer: MutationObserver | undefined;
let subscribers = 0;

async function loadSource(kind: RemoteUserNameSourceId, signal: AbortSignal) {
  const url = new URL(location.href);
  if (!resolveSite(url)) throw new BetterNamesPlanError('当前页面不支持此数据源');
  const userId = currentUserId();
  if (kind !== 'plan' && !userId) throw new BetterNamesPlanError('请先登录', true);
  const context = accountContext();
  if (kind === 'official') officialAccess = undefined;
  const path =
    kind === 'official'
      ? '/user/811'
      : kind === 'plan'
        ? '/better_names'
        : `/user/${userId}/friend`;
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { Accept: kind === 'plan' ? 'application/json' : 'text/html' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]),
  });
  if (response.status === 401) throw new BetterNamesPlanError('请先登录', true);
  if (response.status === 403) throw new BetterNamesPlanError('暂无访问权限', true);
  if (!response.ok) throw new BetterNamesPlanError('暂时无法更新');
  if (kind === 'plan' && response.headers.get('content-type')?.includes('text/html'))
    throw new BetterNamesPlanError('请先登录', true);
  if (Number(response.headers.get('content-length')) > maxBetterNamesPlanLength)
    throw new BetterNamesPlanError('数据过大');
  const text = await response.text();
  if (text.length > maxBetterNamesPlanLength) throw new BetterNamesPlanError('数据过大');
  if (kind !== 'plan') {
    // A template keeps scripts, images and forms inert while reading table cells.
    const template = document.createElement('template');
    template.innerHTML = text;
    if (kind === 'official') {
      const password = officialUserNamePassword(template.content);
      try {
        const entries = await decryptOfficialUserNames(password);
        if (signal.aborted || accountContext() !== context) throw new Error();
        officialAccess = { context, password };
        return entries;
      } catch {
        throw new BetterNamesPlanError('官方数据无法解锁', true);
      }
    }
    return parseFriendUserNames(template.content, url);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BetterNamesPlanError('计划数据格式无效');
  }
  return parseBetterNamesPlan(data);
}

function remoteSource(kind: RemoteUserNameSourceId) {
  let source = sources.get(kind);
  if (!source) {
    source = createBetterNamesPlanSource(
      (signal) => loadSource(kind, signal),
      () => {
        const context = accountContext();
        if (officialAccess?.context !== context) officialAccess = undefined;
        return context;
      },
    );
    sources.set(kind, source);
  }
  return source;
}

export async function requireOfficialUserNames() {
  const source = remoteSource('official');
  source.checkContext();
  await source.refresh(!officialAccess);
  if (!officialAccess || officialAccess.context !== accountContext())
    throw new Error(currentUserId() ? '请先解锁官方数据源' : '请先登录');
  const password = officialAccess.password;
  // Imports must validate against the complete official source even when it is disabled.
  const entries = await decryptOfficialUserNames(password);
  if (officialAccess?.password !== password || officialAccess.context !== accountContext())
    throw new Error('账号已切换，请重试');
  return { ...userNameEntryDatabase(entries), password };
}

export const refreshUserNameRemoteSource = (kind: RemoteUserNameSourceId) =>
  remoteSource(kind).refresh(true);
export const cancelUserNameRemoteSource = (kind: RemoteUserNameSourceId) =>
  sources.get(kind)?.cancel();

export function watchUserNameRemoteSource(
  kind: RemoteUserNameSourceId,
  scope: Scope,
  render: (state: BetterNamesPlanState) => void,
  auto = false,
): void {
  const client = remoteSource(kind);
  if (auto) automatic[kind]++;
  subscribers++;
  const unsubscribe = client.subscribe(render);
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const [kind, source] of sources)
        if (source.checkContext() && automatic[kind]) void source.refresh();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-user_id', 'data-user-id', 'href'],
    });
  }
  scope.defer(() => {
    unsubscribe();
    if (auto && --automatic[kind] === 0) client.cancel();
    if (--subscribers === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  });
  if (auto) void client.refresh();
}
