import { browser } from 'wxt/browser';
import { Scope } from '../core/scope';
import { localSettings, watchSettings } from '../platform/settings-repository';
import { watchColorMode } from '../shared/color-mode';
import { defaultAccentColor, paletteVariables } from '../shared/palette';
import type { Settings } from '../shared/settings';
import {
  SUBMITTER_VERSION,
  type SubmitterRequest,
  type SubmitterResponse,
  targetOrigin,
} from './model';
import { parseSubmission, submissionRoute } from './parser';

export function mountSubmitter() {
  const scope = new Scope();
  let accent = defaultAccentColor;
  const setMode = watchColorMode(scope, (scheme) => {
    document.documentElement.style.cssText = paletteVariables(accent, scheme);
  });
  const setAppearance = (settings: Settings) => {
    accent = settings.accentColor;
    setMode(settings.colorMode);
  };
  setMode('light');
  let paletteChanged = false;
  const unwatch = watchSettings(
    (settings) => {
      paletteChanged = true;
      setAppearance(settings);
    },
    () => {},
  );
  void localSettings.read().then(
    (settings) => {
      if (!paletteChanged && !scope.signal.aborted) setAppearance(settings);
    },
    () => {},
  );
  scope.defer(unwatch);
  window.addEventListener('pagehide', () => scope.dispose(), { once: true });
  const statusNode = document.querySelector<HTMLElement>('#login-status');
  const feedback = document.querySelector<HTMLElement>('#feedback');
  const version = document.querySelector<HTMLElement>('#submitter-version');
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  if (!statusNode || !feedback || !version) throw new Error('提交器界面缺失。');
  const status = statusNode;
  version.textContent = `v${SUBMITTER_VERSION}`;

  async function send(message: SubmitterRequest) {
    const result = (await browser.runtime.sendMessage(message)) as SubmitterResponse | undefined;
    if (!result) throw new Error('扩展连接已断开，请重新打开面板。');
    if (!result.ok) throw new Error(result.error);
    return result;
  }
  let statusRevision = 0;
  async function refresh() {
    const revision = ++statusRevision;
    try {
      const result = await send({ channel: 'asterveil:submitter', type: 'status' });
      if (revision !== statusRevision) return;
      status.textContent = `已登录 · ${result.nickname}`;
      status.title = result.origin ?? '';
      status.dataset.state = 'ready';
    } catch (error) {
      if (revision !== statusRevision) return;
      const message = error instanceof Error ? error.message : '无法检查登录状态。';
      status.textContent = /请先在已登录|尚未登录/.test(message) ? '未登录' : '无法检查登录状态';
      status.removeAttribute('title');
      status.dataset.state = 'error';
    }
  }
  let busy = false;
  for (const button of buttons)
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      buttons.forEach((item) => {
        item.disabled = true;
      });
      feedback.hidden = false;
      feedback.dataset.state = 'pending';
      feedback.textContent = button.id === 'login' ? '正在更新登录信息…' : '正在读取并发送提交…';
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined || !tab.url)
          throw new Error('无法访问当前页面，请切换到目标网站后重新打开面板。');
        let result: Extract<SubmitterResponse, { ok: true }>;
        if (button.id === 'login') {
          const origin = targetOrigin(tab.url);
          if (!origin) throw new Error('请先切换到已登录的 7FA4 页面。');
          result = await send({ channel: 'asterveil:submitter', type: 'login', origin });
          await refresh();
        } else {
          submissionRoute(tab.url);
          const [capture] = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ html: document.documentElement.outerHTML, url: location.href }),
          });
          if (!capture?.result) throw new Error('未能读取页面，请刷新提交详情后重试。');
          const submission = parseSubmission(
            capture.result.html,
            capture.result.url,
            button.id === 'send',
          );
          result = await send({ channel: 'asterveil:submitter', type: 'submit', submission });
        }
        feedback.textContent = result.message;
        feedback.dataset.state = 'ready';
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : '操作失败，请重试。';
        feedback.dataset.state = 'error';
      } finally {
        busy = false;
        buttons.forEach((item) => {
          item.disabled = false;
        });
      }
    });
  void refresh();
}
