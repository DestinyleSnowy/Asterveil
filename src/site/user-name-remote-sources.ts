import { browser } from 'wxt/browser';
import type { Scope } from '../core/scope';
import {
  BetterNamesPlanError,
  type BetterNamesPlanState,
  createBetterNamesPlanSource,
  maxBetterNamesPlanLength,
  parseBetterNamesPlan,
} from '../shared/better-names-plan';
import {
  isRemoteUserNameSourceId,
  isUserNameCacheFresh,
  type RemoteUserNameSourceId,
  remoteUserNameSourceIds,
  type UserNameCacheCommand,
  type UserNameCacheConnection,
  type UserNameCacheNotice,
  type UserNameCacheResponse,
} from '../shared/user-name-cache';
import { decryptOfficialUserNames, userNameEntryDatabase } from '../shared/user-name-database';
import type { UserNameEntry } from '../shared/user-name-sources';
import { currentUserId } from './current-user';
import { parseFriendUserNames } from './friend-user-names';
import { officialUserNamePassword } from './official-user-name-password';
import { resolveSite } from './target';

export { type RemoteUserNameSourceId, remoteUserNameSourceIds };

const sources = new Map<RemoteUserNameSourceId, ReturnType<typeof createBetterNamesPlanSource>>();
const automatic: Record<RemoteUserNameSourceId, number> = { official: 0, plan: 0, friends: 0 };
let officialAccess:
  | { context: string; password: string; entries: readonly UserNameEntry[] }
  | undefined;
const accountContext = () => `${location.origin}:${currentUserId() ?? 'guest'}`;
let session: { context: string; promise: Promise<UserNameCacheConnection | undefined> } | undefined;
let observer: MutationObserver | undefined;
let subscribers = 0;

async function cacheRequest(request: UserNameCacheCommand) {
  const response: UserNameCacheResponse | undefined = await browser.runtime
    .sendMessage({ ...request, channel: 'asterveil', type: 'user-names.cache' })
    .catch(() => undefined);
  if (response?.ok === false && response.clearCache)
    throw new BetterNamesPlanError(response.error, true);
  return response?.ok ? response : undefined;
}

function cacheSession(context: string) {
  if (session?.context !== context)
    session = {
      context,
      promise: cacheRequest({
        action: 'connect',
        account: currentUserId() ?? null,
      }),
    };
  return session.promise;
}

async function loadSource(kind: RemoteUserNameSourceId, signal: AbortSignal, force: boolean) {
  const context = accountContext();
  let cached: Awaited<ReturnType<typeof cacheSession>>;
  try {
    cached = await cacheSession(context);
    if (signal.aborted || accountContext() !== context)
      throw new BetterNamesPlanError('账号已切换，请重试', true);
    const record = cached?.records[kind];
    if (!force && record && (kind !== 'official' || record.password)) {
      if (kind === 'official')
        officialAccess = { context, password: record.password ?? '', entries: record.entries };
      if (!isUserNameCacheFresh(kind, record.savedAt))
        setTimeout(() => {
          if (!signal.aborted && accountContext() === context && automatic[kind])
            void remoteSource(kind).refresh(true);
        }, 0);
      return record.entries;
    }
    const entries = await fetchSource(kind, signal);
    if (signal.aborted || accountContext() !== context)
      throw new BetterNamesPlanError('账号已切换，请重试', true);
    if (cached?.token)
      await cacheRequest({
        action: 'save',
        token: cached.token,
        kind,
        entries,
        ...(kind === 'official' && officialAccess && { password: officialAccess.password }),
      });
    return entries;
  } catch (error) {
    if (error instanceof BetterNamesPlanError && error.clearCache) {
      if (kind === 'official') officialAccess = undefined;
      if (cached?.token) {
        delete cached.records[kind];
        await cacheRequest({
          action: 'discard',
          token: cached.token,
          kind,
        }).catch(() => undefined);
      }
    }
    throw error;
  }
}

async function fetchSource(kind: RemoteUserNameSourceId, signal: AbortSignal) {
  const url = new URL(location.href);
  if (!resolveSite(url)) throw new BetterNamesPlanError('当前页面不支持此数据源');
  const userId = currentUserId();
  if (kind !== 'plan' && !userId) throw new BetterNamesPlanError('请先登录', true);
  const context = accountContext();
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
        officialAccess = { context, password, entries };
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
      (signal, force) => loadSource(kind, signal, force),
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
  const { password, entries } = officialAccess;
  // Imports must validate against the complete official source even when it is disabled.
  if (officialAccess?.password !== password || officialAccess.context !== accountContext())
    throw new Error('账号已切换，请重试');
  return { ...userNameEntryDatabase(entries), password };
}

export const refreshUserNameRemoteSource = (kind: RemoteUserNameSourceId) =>
  remoteSource(kind).refresh(true);
export const cancelUserNameRemoteSource = (kind: RemoteUserNameSourceId) =>
  sources.get(kind)?.cancel();

const onCacheNotice: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
  message: UserNameCacheNotice,
  sender,
) => {
  if (
    sender.id !== browser.runtime.id ||
    sender.tab ||
    message?.type !== 'asterveil:user-names.cache-changed' ||
    !session ||
    session.context !== accountContext()
  )
    return false;
  const active = session;
  void active.promise
    .then((cached) => {
      if (
        !cached?.ok ||
        cached.token !== message.token ||
        session !== active ||
        active.context !== accountContext()
      )
        return;
      if (!message.kind) {
        officialAccess = undefined;
        for (const kind of remoteUserNameSourceIds) delete cached.records[kind];
        for (const source of sources.values()) source.invalidate('账号已切换，请刷新页面');
        return;
      }
      if (!isRemoteUserNameSourceId(message.kind)) return;
      const kind = message.kind;
      if (message.record) {
        cached.records[kind] = message.record;
        if (kind === 'official' && message.record.password)
          officialAccess = {
            context: active.context,
            password: message.record.password,
            entries: message.record.entries,
          };
        sources.get(kind)?.seed(message.record.entries);
      } else {
        delete cached.records[kind];
        if (kind === 'official') officialAccess = undefined;
        sources.get(kind)?.invalidate('数据已失效，请刷新');
      }
    })
    .catch(() => undefined);
  return false;
};

const onCacheResume = (event: PageTransitionEvent) => {
  if (!event.persisted || !session || session.context !== accountContext()) return;
  const active = session;
  void active.promise
    .then((previous) =>
      cacheRequest({
        action: 'connect',
        account: currentUserId() ?? null,
        ...(previous && { token: previous.token }),
      }),
    )
    .then((cached) => {
      if (!cached || session !== active || active.context !== accountContext()) return;
      session = { context: active.context, promise: Promise.resolve(cached) };
      for (const kind of remoteUserNameSourceIds) {
        const record = cached.records[kind];
        if (record) {
          if (kind === 'official' && record.password)
            officialAccess = {
              context: active.context,
              password: record.password,
              entries: record.entries,
            };
          sources.get(kind)?.seed(record.entries);
        }
        if (automatic[kind] && (!record || !isUserNameCacheFresh(kind, record.savedAt)))
          void sources.get(kind)?.refresh(true);
      }
    })
    .catch((error) => {
      if (!(error instanceof BetterNamesPlanError) || !error.clearCache || session !== active)
        return;
      officialAccess = undefined;
      void active.promise
        .then((cached) => {
          if (cached) for (const kind of remoteUserNameSourceIds) delete cached.records[kind];
        })
        .catch(() => undefined);
      for (const source of sources.values()) source.invalidate(error.message);
    });
};

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
    browser.runtime.onMessage.addListener(onCacheNotice);
    window.addEventListener('pageshow', onCacheResume);
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
      browser.runtime.onMessage.removeListener(onCacheNotice);
      window.removeEventListener('pageshow', onCacheResume);
    }
  });
  if (auto) void client.refresh();
}
