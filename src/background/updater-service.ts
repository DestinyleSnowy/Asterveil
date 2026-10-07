import { browser } from 'wxt/browser';
import { pdfEnabled } from '../shared/edition';
import { isRecord } from '../shared/settings';
import {
  initialUpdateState,
  readUpdateState,
  type UpdateRequest,
  type UpdateState,
  updateChannel,
  updateHost,
  updateStorageKey,
} from '../shared/updater';
import { contentMatches } from '../site/target';

const alarmName = 'asterveil:update-check';
const retryAlarm = 'asterveil:update-apply';
const edition = pdfEnabled ? 'full' : 'light';

export function createUpdaterService(isBusy: () => boolean = () => false) {
  let state: UpdateState = { ...initialUpdateState };
  let operation: Promise<void> | undefined;
  let generation = 0;
  const runningVersion = browser.runtime.getManifest().version;
  const ready = browser.storage.local.get(updateStorageKey).then((stored) => {
    state = readUpdateState(stored[updateStorageKey]);
  });
  async function save(patch: Partial<UpdateState>) {
    state = { ...state, ...patch };
    await browser.storage.local.set({ [updateStorageKey]: state });
  }
  function native(command: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let port: ReturnType<typeof browser.runtime.connectNative>;
      try {
        port = browser.runtime.connectNative(updateHost);
      } catch {
        reject(new Error('请先安装并绑定本地更新器'));
        return;
      }
      let done = false;
      const finish = (error?: Error, result?: Record<string, unknown>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        port.disconnect();
        if (error) reject(error);
        else resolve(result ?? {});
      };
      const timer = setTimeout(() => finish(new Error('更新请求超时，请稍后重试')), 12 * 60_000);
      port.onDisconnect.addListener(() => {
        // Reading lastError also prevents Chromium's unchecked-error diagnostic.
        const error = browser.runtime.lastError;
        finish(new Error(error ? '无法连接更新器，请检查安装与绑定' : '更新器连接中断'));
      });
      port.onMessage.addListener((response: unknown) => {
        if (!isRecord(response) || response.ok !== true || !isRecord(response.result)) {
          finish(
            new Error(
              isRecord(response) && typeof response.error === 'string'
                ? response.error
                : '更新器响应无效',
            ),
          );
        } else finish(undefined, response.result);
      });
      port.postMessage({ protocol: 1, command, version: runningVersion, edition });
    });
  }
  async function unlock(ids: number[]) {
    await Promise.allSettled(
      ids.map((id) => browser.tabs.sendMessage(id, { channel: updateChannel, type: 'unlock' })),
    );
  }
  async function applyPrepared() {
    const started = generation;
    if (isBusy()) return waitForIdle();
    const popups = await browser.runtime.getContexts({ contextTypes: ['POPUP'] });
    if (popups.length > 0) return waitForIdle();
    const tabs = await browser.tabs.query({ url: contentMatches });
    const ids = tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
    const locked: number[] = [];
    let reloading = false;
    try {
      for (const id of ids) {
        const allowed = await Promise.race([
          browser.tabs.sendMessage(id, { channel: updateChannel, type: 'lock' }),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
        ]).catch(() => false);
        if (allowed !== true) {
          await waitForIdle();
          return;
        }
        locked.push(id);
      }
      // A new tab may have appeared while the existing pages were checked.
      const again = await browser.tabs.query({ url: contentMatches });
      if (again.some((tab) => tab.id !== undefined && !ids.includes(tab.id))) {
        await waitForIdle();
        return;
      }
      if (started !== generation) return;
      if (isBusy() || (await browser.runtime.getContexts({ contextTypes: ['POPUP'] })).length) {
        await waitForIdle();
        return;
      }
      await save({ status: 'installing', message: '正在安装更新…' });
      const result = await native('apply');
      if (result.state !== 'installed') throw new Error('更新安装未完成');
      await save({ status: 'current', message: '', version: String(result.version) });
      // Release the temporary interaction lock before invalidating content-script contexts.
      await unlock(locked);
      reloading = true;
      browser.runtime.reload();
    } finally {
      if (!reloading) await unlock(ids);
    }
  }
  async function waitForIdle() {
    await save({ status: 'waiting', message: '已下载，等待页面空闲' });
    await browser.alarms.create(retryAlarm, { delayInMinutes: 1 });
  }
  async function failure(error: unknown) {
    const message = error instanceof Error ? error.message : '更新失败，请稍后重试';
    await save({
      status: /安装.*绑定|连接更新器|尚未绑定/.test(message) ? 'unavailable' : 'error',
      message,
    });
  }
  function run(action: () => Promise<void>) {
    if (operation) return operation;
    operation = ready
      .then(action)
      .catch(failure)
      .finally(() => {
        operation = undefined;
      });
    return operation;
  }
  async function check() {
    const started = generation;
    await save({ status: 'checking', message: '正在检测网络与更新…', checkedAt: Date.now() });
    const result = await native('prepare');
    if (started !== generation) return;
    if (result.state === 'prepared') {
      await save({ version: String(result.version) });
      await applyPrepared();
    } else if (result.state === 'current') {
      await save({ status: 'current', message: '当前已是最新版本', version: runningVersion });
    } else throw new Error('更新器响应无效');
  }
  async function startup() {
    await ready;
    // Acknowledgement must happen even if the preference was disabled during reload.
    if (
      state.enabled ||
      state.status === 'installing' ||
      (state.version && state.version === runningVersion)
    ) {
      try {
        const status = await native('status');
        if (isRecord(status.transaction) && status.transaction.phase === 'pending') {
          if (status.version === runningVersion) {
            await native('confirm');
            await save({ status: 'current', message: '', version: runningVersion });
          } else {
            browser.runtime.reload();
            return;
          }
        } else if (status.version !== runningVersion) {
          browser.runtime.reload();
          return;
        }
      } catch (error) {
        await failure(error);
      }
    }
    if (state.enabled) {
      if (!(await browser.alarms.get(alarmName))) {
        await browser.alarms.create(alarmName, { periodInMinutes: 360 });
      }
      if (state.status === 'waiting') await applyPrepared();
      else if (Date.now() - state.checkedAt >= 360 * 60_000) await check();
    }
  }
  const initialized = run(startup);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== alarmName && alarm.name !== retryAlarm) return;
    void initialized
      .then(() => {
        if (!state.enabled && alarm.name === alarmName) return;
        if (alarm.name === retryAlarm && state.status !== 'waiting') return;
        return run(alarm.name === retryAlarm ? applyPrepared : check);
      })
      .catch(() => {});
  });
  browser.runtime.onStartup.addListener(() => {
    const started = Date.now();
    void initialized
      .then(() => {
        if (state.enabled && state.checkedAt < started) return run(check);
      })
      .catch(failure);
  });
  // MV3 does not necessarily start a new worker after reload without a listener
  // for the update event. Register it so startup can acknowledge the new files.
  browser.runtime.onInstalled.addListener(() => {
    // Registering the event wakes the worker; initialized handles acknowledgement.
  });
  return async (request: UpdateRequest): Promise<UpdateState> => {
    await ready;
    if (request.type === 'enabled') {
      await save({ enabled: request.enabled });
      if (request.enabled) {
        await browser.alarms.create(alarmName, { periodInMinutes: 360 });
        void initialized
          .then(() => {
            if (state.enabled) return run(check);
          })
          .catch(failure);
      } else {
        generation++;
        await browser.alarms.clear(alarmName);
        await browser.alarms.clear(retryAlarm);
        if (state.status === 'waiting' || state.status === 'checking') {
          await save({ status: 'idle', message: '' });
        }
      }
    }
    if (request.type === 'check') void initialized.then(() => run(check)).catch(failure);
    return state;
  };
}
