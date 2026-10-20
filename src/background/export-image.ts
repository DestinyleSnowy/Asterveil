import { isExportImageUrl, maxExportImageBytes } from '../shared/export-image';

// Only the explicitly permitted image origin can be fetched with extension
// privileges. Never forward page cookies or follow redirects to other hosts.
export async function fetchExportImage(url: string): Promise<string> {
  if (!isExportImageUrl(url)) throw new Error('不支持此图片来源。');
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('图片读取失败，请检查网络后重试。');
  }
  if (!response.ok) throw new Error(`图片加载失败（HTTP ${response.status}）。`);
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!type || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type))
    throw new Error('图片格式不支持导出。');
  if (Number(response.headers.get('content-length')) > maxExportImageBytes) {
    await response.body?.cancel();
    throw new Error('图片超过 10 MB，请缩小后重试。');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('图片内容为空。');
  let size = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxExportImageBytes) {
        await reader.cancel();
        throw new Error('图片超过 10 MB，请缩小后重试。');
      }
      for (let offset = 0; offset < value.length; offset += 32768)
        chunks.push(String.fromCharCode(...value.subarray(offset, offset + 32768)));
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error('图片内容为空。');
  return `data:${type};base64,${btoa(chunks.join(''))}`;
}
