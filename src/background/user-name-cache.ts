import type {
  UserNameCacheNotice,
  UserNameCacheRecords,
  UserNameCacheRequest,
  UserNameCacheResponse,
} from '../shared/user-name-cache';

interface Client {
  origin: string;
  documentId: string;
  tabId: number;
}
interface Binding extends Client {
  account: number | null;
  token: string | null;
}
interface Session {
  account: number;
  token: string;
  records: UserNameCacheRecords;
}
interface CacheState {
  revision: string;
  sessions: Record<string, Session>;
  documents: Record<string, Binding>;
}

export function createUserNameCache(
  repository: { read(): Promise<unknown>; write(state: CacheState): Promise<void> },
  revision: string,
  notify: (client: Client, notice: UserNameCacheNotice) => void,
  now = Date.now,
) {
  let queue: Promise<unknown> = Promise.resolve();
  let cached: CacheState | undefined;
  return (request: UserNameCacheRequest, client: Client): Promise<UserNameCacheResponse> => {
    const result = queue.then(async (): Promise<UserNameCacheResponse> => {
      if (!cached) {
        const saved = (await repository.read()) as CacheState | undefined;
        cached =
          saved?.revision === revision && saved.sessions && saved.documents
            ? saved
            : { revision, sessions: {}, documents: {} };
      }
      const state = structuredClone(cached);
      const old = state.documents[client.documentId];
      let session = state.sessions[client.origin];
      const invalid = (): UserNameCacheResponse => ({
        ok: false,
        error: '账号已切换，请刷新页面',
        clearCache: true,
      });
      const notices: { client: Client; notice: UserNameCacheNotice }[] = [];
      if (request.action === 'connect') {
        if (request.token !== undefined && request.token !== (session?.token ?? null))
          return invalid();
        // An old open page must not revive a session invalidated by a newer document.
        if (old && old.account === request.account && old.token !== (session?.token ?? null))
          return invalid();
        if (!session || request.account !== session.account) {
          if (session) {
            for (const binding of Object.values(state.documents))
              if (
                binding.origin === client.origin &&
                binding.token === session.token &&
                binding.documentId !== client.documentId
              )
                notices.push({
                  client: binding,
                  notice: { type: 'asterveil:user-names.cache-changed', token: session.token },
                });
          }
          if (request.account === null) {
            delete state.sessions[client.origin];
            session = undefined;
          } else {
            session = { account: request.account, token: crypto.randomUUID(), records: {} };
            state.sessions[client.origin] = session;
          }
        }
        state.documents[client.documentId] = {
          ...client,
          account: request.account,
          token: session?.token ?? null,
        };
        // Keep recent stale-document guards without retaining an unlimited browsing history.
        const documents = Object.keys(state.documents);
        for (const id of documents.slice(0, Math.max(0, documents.length - 256)))
          delete state.documents[id];
      } else {
        if (
          !session ||
          !old ||
          old.token !== session.token ||
          request.token !== session.token ||
          old.origin !== client.origin
        )
          return invalid();
        if (request.action === 'save') {
          session.records[request.kind] = {
            entries: request.entries,
            savedAt: now(),
            ...(request.password && { password: request.password }),
          };
        } else delete session.records[request.kind];
        for (const binding of Object.values(state.documents))
          if (
            binding.origin === client.origin &&
            binding.token === session.token &&
            binding.documentId !== client.documentId
          )
            notices.push({
              client: binding,
              notice: {
                type: 'asterveil:user-names.cache-changed',
                token: session.token,
                kind: request.kind,
                ...(session.records[request.kind] && { record: session.records[request.kind] }),
              },
            });
      }
      await repository.write(state);
      cached = state;
      for (const item of notices) notify(item.client, item.notice);
      return { ok: true, token: session?.token ?? null, records: session?.records ?? {} };
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
