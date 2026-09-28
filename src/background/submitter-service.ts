import { browser } from 'wxt/browser';
import { isRecord } from '../shared/settings';
import {
  SUBMITTER_ORIGIN_KEY,
  type SubmitterRequest,
  type SubmitterResponse,
  targetOrigin,
} from '../submitter/model';

async function requestJson(
  origin: string,
  path: '/user_api/json' | '/foreign_oj',
  submission?: unknown,
): Promise<unknown> {
  const response = await fetch(origin + path, {
    method: submission ? 'POST' : 'GET',
    credentials: 'include',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    ...(submission
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission) }
      : {}),
  });
  if (!response.ok) throw new Error(`7FA4 请求失败（HTTP ${response.status}）。`);
  try {
    return await response.json();
  } catch {
    throw new Error('7FA4 返回了无法识别的内容，请检查登录状态。');
  }
}

async function login(origin: string): Promise<string> {
  const result = await requestJson(origin, '/user_api/json');
  if (
    !isRecord(result) ||
    result.success !== true ||
    !isRecord(result.user) ||
    typeof result.user.nickname !== 'string'
  ) {
    throw new Error('尚未登录 7FA4，或登录已失效。请到对应入口登录后更新登录信息。');
  }
  return result.user.nickname;
}

export function createSubmitterService() {
  let submitting = false;
  return async (message: SubmitterRequest): Promise<SubmitterResponse> => {
    try {
      if (message.type === 'login') {
        const nickname = await login(message.origin);
        await browser.storage.local.set({ [SUBMITTER_ORIGIN_KEY]: message.origin });
        return { ok: true, nickname, origin: message.origin, message: '登录信息已更新。' };
      }
      const saved = (await browser.storage.local.get(SUBMITTER_ORIGIN_KEY))[SUBMITTER_ORIGIN_KEY];
      const origin = typeof saved === 'string' ? targetOrigin(saved) : null;
      if (!origin) throw new Error('请先在已登录的 7FA4 页面点击“更新登录信息”。');
      if (message.type === 'status')
        return { ok: true, origin, nickname: await login(origin), message: '' };
      if (submitting) throw new Error('已有提交正在发送，请稍候。');
      submitting = true;
      try {
        // Verify the current browser session; never persist or copy authentication cookies.
        await login(origin);
        let result: unknown;
        try {
          result = await requestJson(origin, '/foreign_oj', message.submission);
        } catch {
          // A failed response does not prove the server rejected the POST.
          throw new Error('未能确认提交结果，请先到 7FA4 提交记录核对，再决定是否重试。');
        }
        if (!isRecord(result)) throw new Error('未收到明确的提交结果，请先到 7FA4 提交记录核对。');
        if (result.success !== true)
          throw new Error(
            typeof result.err === 'string' ? result.err : '7FA4 未确认提交成功，请查看提交记录。',
          );
        return {
          ok: true,
          message: typeof result.info === 'string' ? result.info : '提交已发送。',
        };
      } finally {
        submitting = false;
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '操作失败，请重试。' };
    }
  };
}
