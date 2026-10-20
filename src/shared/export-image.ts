export const maxExportImageBytes = 10 * 1024 * 1024;

export interface ExportImageRequest {
  channel: 'asterveil:export-image';
  url: string;
}

export interface ExportImageAccessRequest {
  channel: 'asterveil:export-image-access';
  urls: string[];
}

export type ExportImageResponse =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string; permissionUrl?: string };

export type ExportImageAccessResponse = { ok: true } | { ok: false; error: string };

export function isExportImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.hostname.includes('*') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function imagePermissionOrigin(value: string): string {
  if (!isExportImageUrl(value)) throw new Error('不支持此图片来源。');
  const url = new URL(value);
  // Chrome host permissions apply to all ports, and never need URL paths/queries.
  return `${url.protocol}//${url.hostname}/*`;
}

export function isExportImageAccessRequest(value: unknown): value is ExportImageAccessRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channel' in value &&
    value.channel === 'asterveil:export-image-access' &&
    'urls' in value &&
    Array.isArray(value.urls) &&
    value.urls.length > 0 &&
    value.urls.length <= 200 &&
    value.urls.every(isExportImageUrl)
  );
}

export async function imageResponseData(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`图片加载失败（HTTP ${response.status}）。`);
  let type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
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
  const bytes = chunks.join('');
  // Some image CDNs return generic binary MIME types. Identify common formats
  // by their bytes instead of relying on an extension in a signed URL.
  if (bytes.startsWith('\x89PNG\r\n\x1a\n')) type = 'image/png';
  else if (bytes.startsWith('\xff\xd8\xff')) type = 'image/jpeg';
  else if (/^GIF8[79]a/.test(bytes)) type = 'image/gif';
  else if (bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP') type = 'image/webp';
  else if (bytes.startsWith('BM')) type = 'image/bmp';
  else if (bytes.startsWith('\x00\x00\x01\x00')) type = 'image/x-icon';
  else if (bytes.slice(4, 8) === 'ftyp' && /avif|avis/.test(bytes.slice(8, 32)))
    type = 'image/avif';
  if (
    !type ||
    !/^image\/(?:png|jpeg|webp|gif|avif|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)$/.test(type)
  )
    throw new Error('图片格式不支持导出。');
  return `data:${type};base64,${btoa(bytes)}`;
}

export function isExportImageRequest(value: unknown): value is ExportImageRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channel' in value &&
    value.channel === 'asterveil:export-image' &&
    'url' in value &&
    isExportImageUrl(value.url)
  );
}
