import {
  type ExportImageResponse,
  imagePermissionOrigin,
  imageResponseData,
  isExportImageUrl,
} from '../shared/export-image';

export async function fetchExportImage(
  url: string,
  hasPermission: (origin: string) => Promise<boolean>,
  watchRedirects: (
    url: string,
    onRedirect: (url: string) => void,
  ) => Promise<() => void> = async () => () => {},
): Promise<ExportImageResponse> {
  const signal = AbortSignal.timeout(20000);
  const visited = new Set<string>();
  for (let hop = 0; hop < 8; hop++) {
    if (!isExportImageUrl(url)) throw new Error('不支持此图片来源。');
    if (visited.has(url)) throw new Error('图片链接循环跳转。');
    visited.add(url);
    if (!(await hasPermission(imagePermissionOrigin(url))))
      return { ok: false, error: '需要授权读取图片来源。', permissionUrl: url };
    let response: Response;
    const redirects: string[] = [];
    const stopWatching = await watchRedirects(url, (target) => {
      redirects.push(target);
    });
    try {
      response = await fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
        signal,
      });
    } catch {
      signal.throwIfAborted();
      const target = redirects.at(-1);
      if (!target) throw new Error('图片读取失败，请检查链接或网络后重试。');
      // A redirect can remain CORS-tainted even with both hosts permitted.
      // Retry its actual destination as a fresh, permission-checked request.
      url = target;
      continue;
    } finally {
      stopWatching();
    }
    return { ok: true, dataUrl: await imageResponseData(response) };
  }
  throw new Error('图片链接跳转过多。');
}
