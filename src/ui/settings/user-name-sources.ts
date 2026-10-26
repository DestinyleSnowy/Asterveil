import type { Scope } from '../../core/scope';
import type { BetterNamesPlanState } from '../../shared/better-names-plan';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';
import { userGradeAcademicYear } from '../../shared/user-grade-year';
import { userNameEntryDatabase } from '../../shared/user-name-database';
import {
  activeUserNameRecords,
  isBuiltinUserNameSourceId,
  isUserNameSourceName,
  maxUserNameImportLength,
  mergedUserNames,
  parseUserNameSource,
} from '../../shared/user-name-sources';
import {
  cancelUserNameRemoteSource,
  type RemoteUserNameSourceId,
  refreshUserNameRemoteSource,
  remoteUserNameSourceIds,
  requireOfficialUserNames,
  watchUserNameRemoteSource,
} from '../../site/user-name-remote-sources';
import { settingsIcon } from './icons';

export function mountUserNameSources(
  root: ParentNode,
  scope: Scope,
  save: (command: SettingsCommand) => Promise<Settings>,
) {
  function element<T extends HTMLElement>(id: string): T {
    const node = root.querySelector(`#${id}`);
    if (!node) throw new Error(`Missing element: ${id}`);
    return node as T;
  }
  const list = element<HTMLUListElement>('user-name-source-list');
  const file = element<HTMLInputElement>('user-name-file');
  const pick = element<HTMLButtonElement>('user-name-import');
  const template = element<HTMLButtonElement>('user-name-template');
  const message = element<HTMLButtonElement>('user-name-source-status');
  const feedback = element<HTMLSpanElement>('user-name-source-feedback');
  const detail = element<HTMLSpanElement>('user-name-source-detail');
  const remote = Object.fromEntries(
    remoteUserNameSourceIds.map((kind) => {
      const message = document.createElement('span');
      message.id =
        kind === 'official'
          ? 'user-official-source-status'
          : kind === 'plan'
            ? 'better-names-source-status'
            : 'user-friend-source-status';
      message.className = 'name-source-error';
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      message.hidden = true;
      return [
        kind,
        {
          name: kind === 'official' ? '官方' : kind === 'plan' ? 'Better Names 计划' : '我的好友',
          refreshId:
            kind === 'official'
              ? 'user-official-source-refresh'
              : kind === 'plan'
                ? 'better-names-source-refresh'
                : 'user-friend-source-refresh',
          message,
          state: { entries: [], loaded: false, loading: false, error: '' } as BetterNamesPlanState,
        },
      ];
    }),
  ) as Record<
    RemoteUserNameSourceId,
    {
      name: string;
      refreshId: string;
      message: HTMLSpanElement;
      state: BetterNamesPlanState;
    }
  >;
  let current: Settings | undefined;
  let renderedRevision: number | undefined;
  let busy = false;
  const templateUrl = `data:application/json;charset=utf-8,${encodeURIComponent(
    `${JSON.stringify(
      {
        academicYear: userGradeAcademicYear,
        users: {
          900000001: { name: '示例姓名一', colorKey: 'g1' },
          900000002: { name: '示例姓名二', colorKey: 'c1' },
        },
      },
      null,
      2,
    )}\n`,
  )}`;
  template.addEventListener(
    'click',
    () => {
      const link = document.createElement('a');
      link.href = templateUrl;
      link.download = 'better-names-source.json';
      template.after(link);
      link.click();
      link.remove();
    },
    { signal: scope.signal },
  );

  function showMessage(text: string, error = false) {
    message.textContent = text;
    detail.textContent = text;
    message.classList.toggle('error', error);
    message.hidden = feedback.hidden = !text;
    if (text) pick.setAttribute('aria-describedby', message.id);
    else pick.removeAttribute('aria-describedby');
  }
  function showError(error: unknown) {
    showMessage(error instanceof Error ? error.message : '数据源操作失败', true);
  }
  function clearMessage() {
    showMessage('');
  }
  function renderRemote(kind: RemoteUserNameSourceId) {
    if (scope.signal.aborted) return;
    const enabled = current?.userNames.builtin[kind] ?? true;
    const { state, refreshId, message, name } = remote[kind];
    const failed = enabled && !!state.error && !state.loading;
    const count = list.querySelector<HTMLSpanElement>(
      `[data-source-id="${kind}"] .name-source-count`,
    );
    if (count) {
      count.hidden = failed;
      count.textContent = state.loading
        ? kind === 'official'
          ? '解锁中…'
          : '更新中…'
        : state.loaded
          ? `${state.entries.length.toLocaleString('zh-CN')} 人`
          : kind === 'official'
            ? '未解锁'
            : '未更新';
    }
    const refresh = list.querySelector<HTMLButtonElement>(`#${refreshId}`);
    if (refresh) {
      refresh.disabled = busy || !current || !enabled || state.loading;
      if (failed) refresh.setAttribute('aria-describedby', message.id);
      else refresh.removeAttribute('aria-describedby');
    }
    message.textContent = state.error;
    message.setAttribute('aria-label', `${name}：${state.error}`);
    message.hidden = !failed;
  }
  function render(settings = current) {
    if (scope.signal.aborted) return;
    if (!current || (settings && settings.revision >= current.revision)) current = settings;
    const revision = current?.userNames.revision ?? -1;
    if (renderedRevision !== revision) {
      renderedRevision = revision;
      if (current) {
        try {
          const official = userNameEntryDatabase(remote.official.state.entries);
          activeUserNameRecords(official.names, current.userNames, official.grades);
        } catch (error) {
          showError(error);
        }
      }
      const row = (name: string, count: number, id: string, custom = false) => {
        const item = document.createElement('li');
        item.className = 'name-source-row';
        item.dataset.sourceId = id;
        const identity = document.createElement('label');
        identity.className = 'name-source-identity';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.setAttribute('role', 'switch');
        toggle.dataset.sourceToggle = id;
        toggle.setAttribute('aria-label', `启用数据源 ${name}`);
        toggle.checked = isBuiltinUserNameSourceId(id)
          ? (current?.userNames.builtin[id] ?? true)
          : (current?.userNames.sources.find((source) => source.id === id)?.enabled ?? true);
        toggle.setAttribute('aria-checked', String(toggle.checked));
        const title = document.createElement('strong');
        title.textContent = name;
        title.title = name;
        identity.append(toggle, title);
        if (custom) {
          const kind = document.createElement('span');
          kind.className = 'name-source-kind';
          kind.textContent = '自定义';
          identity.append(kind);
        }
        const total = document.createElement('span');
        total.className = 'name-source-count';
        total.textContent = `${count.toLocaleString('zh-CN')} 人`;
        const state = document.createElement('span');
        state.className = 'name-source-state';
        state.append(total);
        item.append(identity, state);
        if (custom) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'name-source-remove';
          remove.dataset.sourceRemove = id;
          remove.title = `移除 ${name}`;
          remove.setAttribute('aria-label', `移除数据源 ${name}`);
          remove.innerHTML = settingsIcon('close');
          item.append(remove);
        }
        return item;
      };
      const remoteRows = (['official', 'friends', 'plan'] as const).map((kind) => {
        const { name, refreshId, message } = remote[kind];
        const item = row(name, 0, kind);
        item.querySelector('.name-source-state')?.append(message);
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.id = refreshId;
        refresh.dataset.remoteSource = kind;
        refresh.className = 'name-source-refresh';
        const action =
          kind === 'official'
            ? '重新解锁官方数据'
            : kind === 'plan'
              ? '刷新 Better Names 计划数据'
              : '刷新我的好友数据';
        refresh.title = action;
        refresh.setAttribute('aria-label', action);
        if (kind !== 'official')
          refresh.setAttribute('aria-description', '仅补充未收录用户，已启用的本地名单优先');
        refresh.innerHTML = settingsIcon('refresh');
        item.append(refresh);
        return item;
      });
      list.replaceChildren(
        ...remoteRows,
        ...(current?.userNames.sources.map((source) =>
          row(source.name, source.entries.length, source.id, true),
        ) ?? []),
      );
      for (const kind of remoteUserNameSourceIds)
        if (current && !current.userNames.builtin[kind]) cancelUserNameRemoteSource(kind);
    }
    pick.disabled = busy || !current;
    template.disabled = busy || !current;
    file.disabled = busy || !current;
    pick.textContent = busy ? '处理中…' : '导入';
    for (const button of list.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = busy || !current;
    for (const toggle of list.querySelectorAll<HTMLInputElement>('input[data-source-toggle]'))
      toggle.disabled = busy || !current;
    for (const kind of remoteUserNameSourceIds) renderRemote(kind);
  }
  for (const kind of remoteUserNameSourceIds)
    watchUserNameRemoteSource(kind, scope, (state) => {
      remote[kind].state = state;
      renderRemote(kind);
      if (kind === 'official' && current) {
        try {
          const official = userNameEntryDatabase(state.entries);
          activeUserNameRecords(official.names, current.userNames, official.grades);
        } catch (error) {
          showError(error);
        }
      }
    });
  list.addEventListener(
    'click',
    (event) => {
      const refresh = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-remote-source]',
      );
      const kind = refresh?.dataset.remoteSource;
      if (
        refresh &&
        !refresh.disabled &&
        (kind === 'official' || kind === 'plan' || kind === 'friends')
      )
        void refreshUserNameRemoteSource(kind);
    },
    { signal: scope.signal },
  );
  pick.addEventListener('click', () => file.click(), { signal: scope.signal });
  file.addEventListener(
    'change',
    async () => {
      const selected = file.files?.[0];
      file.value = '';
      if (!selected || busy || !current) return;
      clearMessage();
      busy = true;
      render();
      try {
        if (selected.size > maxUserNameImportLength) throw new Error('数据文件不能超过 2 MB');
        const text = await selected.text();
        if (scope.signal.aborted) return;
        const entries = parseUserNameSource(text);
        const name =
          selected.name
            .replace(/\.json$/i, '')
            .trim()
            .slice(0, 80) || '自定义数据源';
        if (!isUserNameSourceName(name)) throw new Error('数据源名称不能包含控制字符');
        const official = await requireOfficialUserNames();
        if (scope.signal.aborted) return;
        mergedUserNames(
          official.names,
          [...current.userNames.sources, { id: '', name, enabled: true, entries }],
          official.grades,
        );
        const before = current.userNames.revision;
        const settings = await save({
          type: 'settings.user-names.import',
          name,
          text,
          officialPassword: official.password,
        });
        if (scope.signal.aborted) return;
        render(settings);
        if (settings.userNames.revision === before) {
          showMessage('数据源已存在');
        }
      } catch (error) {
        if (!scope.signal.aborted) showError(error);
      } finally {
        busy = false;
        if (!scope.signal.aborted) {
          render();
          pick.focus({ preventScroll: true });
        }
      }
    },
    { signal: scope.signal },
  );
  list.addEventListener(
    'click',
    async (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-source-remove]',
      );
      const id = button?.dataset.sourceRemove;
      if (!id || busy || !current) return;
      clearMessage();
      busy = true;
      render();
      try {
        const settings = await save({ type: 'settings.user-names.remove', id });
        if (!scope.signal.aborted) render(settings);
      } catch (error) {
        if (!scope.signal.aborted) showError(error);
      } finally {
        busy = false;
        if (!scope.signal.aborted) {
          render();
          pick.focus({ preventScroll: true });
        }
      }
    },
    { signal: scope.signal },
  );
  list.addEventListener(
    'change',
    async (event) => {
      const toggle = event.target as HTMLInputElement;
      const id = toggle.dataset.sourceToggle;
      if (!id || busy || !current) return;
      clearMessage();
      const enabled = toggle.checked;
      toggle.setAttribute('aria-checked', String(enabled));
      busy = true;
      render();
      try {
        const settings = await save({ type: 'settings.user-names.source', id, enabled });
        if (!scope.signal.aborted) render(settings);
      } catch (error) {
        if (!scope.signal.aborted) {
          renderedRevision = undefined;
          showError(error);
        }
      } finally {
        busy = false;
        if (!scope.signal.aborted) {
          render();
          list
            .querySelector<HTMLInputElement>(`input[data-source-toggle="${id}"]`)
            ?.focus({ preventScroll: true });
        }
      }
    },
    { signal: scope.signal },
  );
  return { render };
}
