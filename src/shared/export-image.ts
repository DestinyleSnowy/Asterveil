export const exportImageOrigin = 'https://images.openai.com';
export const maxExportImageBytes = 10 * 1024 * 1024;

export interface ExportImageRequest {
  channel: 'asterveil:export-image';
  url: string;
}

export type ExportImageResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export function isExportImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.origin === exportImageOrigin && !url.username && !url.password;
  } catch {
    return false;
  }
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
