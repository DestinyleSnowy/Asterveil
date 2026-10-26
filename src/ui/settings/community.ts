import type { Scope } from '../../core/scope';
import { isRecord } from '../../shared/settings';
import { currentUserId } from '../../site/current-user';
import donateQr from './donate.jpg?inline';

export function mountCommunitySettings(root: ParentNode, scope: Scope): void {
  const image = root.querySelector<HTMLImageElement>('#donate-qr');
  if (image) image.src = donateQr;

  const copiedTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  scope.defer(() => {
    for (const timer of copiedTimers.values()) clearTimeout(timer);
  });
  const copyStatus = root.querySelector<HTMLElement>('#community-copy-status');
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-community-copy]')) {
    button.addEventListener(
      'click',
      async () => {
        if (!copyStatus) return;
        copyStatus.hidden = true;
        button.classList.remove('is-copied');
        clearTimeout(copiedTimers.get(button));
        copiedTimers.delete(button);
        try {
          await navigator.clipboard.writeText(button.dataset.communityCopy ?? '');
          if (scope.signal.aborted) return;
          button.classList.add('is-copied');
          copiedTimers.set(
            button,
            setTimeout(() => {
              button.classList.remove('is-copied');
              copiedTimers.delete(button);
            }, 1600),
          );
          copyStatus.className = 'visually-hidden';
          copyStatus.textContent = '已复制';
        } catch {
          if (scope.signal.aborted) return;
          copyStatus.className = 'community-error';
          copyStatus.textContent = '复制失败，请手动复制';
        }
        copyStatus.hidden = false;
      },
      { signal: scope.signal },
    );
  }

  const dialog = root.querySelector<HTMLDialogElement>('#community-dialog');
  const heading = root.querySelector<HTMLElement>('#community-dialog-title');
  const icon = root.querySelector<HTMLElement>('#community-dialog-icon');
  const actions = root.querySelectorAll<HTMLButtonElement>('[data-community-open]');
  const panels = root.querySelectorAll<HTMLElement>('[data-community-panel]');
  const status = root.querySelector<HTMLElement>('#better-names-status');
  const refresh = root.querySelector<HTMLButtonElement>('#better-names-refresh');
  if (!dialog || !heading || !icon || !status || !refresh) return;
  let request: AbortController | undefined;
  let active: HTMLButtonElement | undefined;
  scope.defer(() => {
    request?.abort();
    if (dialog.open) dialog.close();
  });

  for (const action of actions) {
    action.addEventListener(
      'click',
      () => {
        const name = action.dataset.communityOpen;
        for (const panel of panels) panel.hidden = panel.dataset.communityPanel !== name;
        heading.textContent = action.querySelector('.community-action-name')?.textContent ?? '';
        icon.innerHTML = action.querySelector('.community-action-icon')?.innerHTML ?? '';
        active = action;
        action.setAttribute('aria-expanded', 'true');
        dialog.showModal();
        if (name === 'plan') void refreshMembership();
      },
      { signal: scope.signal },
    );
  }
  root.querySelector('#community-close')?.addEventListener('click', () => dialog.close(), {
    signal: scope.signal,
  });
  dialog.addEventListener(
    'click',
    (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    },
    { signal: scope.signal },
  );
  dialog.addEventListener('cancel', (event) => event.stopPropagation(), { signal: scope.signal });
  dialog.addEventListener(
    'close',
    () => {
      active?.setAttribute('aria-expanded', 'false');
      active?.focus({ preventScroll: true });
    },
    { signal: scope.signal },
  );

  async function refreshMembership(): Promise<void> {
    if (!status || !refresh || request || scope.signal.aborted) return;
    status.className = '';
    const uid = currentUserId();
    if (!uid) {
      status.textContent = '未识别当前用户';
      return;
    }
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 9000);
    refresh.disabled = true;
    status.textContent = '正在检查…';
    try {
      const response = await fetch('/better_names', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Membership request failed');
      const data: unknown = await response.json();
      const users = Array.isArray(data) ? data : isRecord(data) ? data.users : undefined;
      if (!Array.isArray(users)) throw new Error('Invalid membership response');
      const joined = users.some(
        (user: unknown) => isRecord(user) && Number(user.id ?? user.user_id ?? user.uid) === uid,
      );
      if (scope.signal.aborted) return;
      status.textContent = joined ? '已加入' : '未加入';
      status.className = joined ? 'community-success' : '';
    } catch {
      if (scope.signal.aborted) return;
      status.textContent = '暂时无法检查';
      status.className = 'community-error';
    } finally {
      clearTimeout(timeout);
      request = undefined;
      if (!scope.signal.aborted) refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', () => void refreshMembership(), { signal: scope.signal });
}
