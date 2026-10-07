import { browser } from 'wxt/browser';
import type { Scope } from '../../core/scope';
import { isRecord } from '../../shared/settings';
import {
  initialUpdateState,
  readUpdateState,
  type UpdateRequest,
  type UpdateState,
  updateChannel,
  updateStatusText,
  updateStorageKey,
} from '../../shared/updater';

export function mountUpdaterSettings(root: ParentNode, scope: Scope): void {
  const enabled = root.querySelector<HTMLInputElement>('#update-enabled');
  const check = root.querySelector<HTMLButtonElement>('#update-check');
  const status = root.querySelector<HTMLElement>('#update-status');
  const install = root.querySelector<HTMLAnchorElement>('#update-install');
  if (!enabled || !check || !status || !install) return;
  let state: UpdateState = { ...initialUpdateState };
  let pending = false;
  let changes = 0;
  function render() {
    if (scope.signal.aborted || !enabled || !check || !status || !install) return;
    enabled.checked = state.enabled;
    enabled.setAttribute('aria-checked', String(state.enabled));
    enabled.disabled = pending || state.status === 'installing';
    check.disabled = pending || state.status === 'checking' || state.status === 'installing';
    status.textContent = updateStatusText(state);
    status.hidden = !status.textContent;
    status.classList.toggle('error', state.status === 'error' || state.status === 'unavailable');
    install.hidden = state.status !== 'unavailable' && state.status !== 'idle';
  }
  async function send(request: UpdateRequest) {
    pending = true;
    render();
    const before = changes;
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (!isRecord(response) || response.ok !== true) throw new Error('无法读取更新状态');
      if (changes === before) state = readUpdateState(response.state);
    } catch (error) {
      state = {
        ...state,
        status: 'error',
        message: error instanceof Error ? error.message : '更新操作失败',
      };
    } finally {
      pending = false;
      render();
    }
  }
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (items, area) => {
    if (area !== 'local' || !items[updateStorageKey]) return;
    changes++;
    state = readUpdateState(items[updateStorageKey].newValue);
    render();
  };
  browser.storage.onChanged.addListener(listener);
  scope.defer(() => browser.storage.onChanged.removeListener(listener));
  enabled.addEventListener(
    'change',
    () => {
      void send({ channel: updateChannel, type: 'enabled', enabled: enabled.checked });
    },
    { signal: scope.signal },
  );
  check.addEventListener(
    'click',
    () => {
      void send({ channel: updateChannel, type: 'check' });
    },
    { signal: scope.signal },
  );
  void send({ channel: updateChannel, type: 'read' });
}
