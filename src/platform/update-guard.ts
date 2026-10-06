import { browser } from 'wxt/browser';
import type { Scope } from '../core/scope';
import { updateChannel } from '../shared/updater';

const blockers = new Set<() => boolean>();
export function preventUpdateWhile(scope: Scope, busy: () => boolean): void {
  blockers.add(busy);
  scope.defer(() => blockers.delete(busy));
}

export function mountUpdateGuard(scope: Scope): void {
  let lastInput = 0;
  let timer = 0;
  let lockedBody: HTMLElement | undefined;
  let wasInert = false;
  const unlock = () => {
    clearTimeout(timer);
    if (lockedBody) lockedBody.inert = wasInert;
    lockedBody = undefined;
  };
  document.addEventListener(
    'input',
    () => {
      lastInput = Date.now();
    },
    {
      capture: true,
      signal: scope.signal,
    },
  );
  document.addEventListener(
    'submit',
    () => {
      lastInput = Date.now();
    },
    {
      capture: true,
      signal: scope.signal,
    },
  );
  const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
    message,
    sender,
    respond,
  ) => {
    if (sender.id !== browser.runtime.id || sender.tab || message?.channel !== updateChannel)
      return false;
    if (message.type === 'unlock') {
      unlock();
      respond(true);
      return false;
    }
    if (message.type !== 'lock') return false;
    const busy = Date.now() - lastInput < 120_000 || [...blockers].some((check) => check());
    if (busy || !document.body) {
      respond(false);
      return false;
    }
    if (!lockedBody) {
      lockedBody = document.body;
      wasInert = lockedBody.inert;
      lockedBody.inert = true;
    }
    clearTimeout(timer);
    timer = window.setTimeout(unlock, 45_000);
    respond(true);
    return false;
  };
  browser.runtime.onMessage.addListener(listener);
  scope.defer(() => {
    unlock();
    browser.runtime.onMessage.removeListener(listener);
  });
}
