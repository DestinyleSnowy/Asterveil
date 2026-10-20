import { fontCss } from 'virtual:homework-katex';
import { toCanvas } from 'html-to-image';
import { browser } from 'wxt/browser';
import {
  type ExportImageAccessRequest,
  type ExportImageRequest,
  imageResponseData,
  isExportImageUrl,
} from '../../shared/export-image';
import { isRecord } from '../../shared/settings';

export const maxPixels = 32_000_000;

export class ImageAccessError extends Error {
  constructor(
    readonly urls: string[],
    message = '需要授权读取图片来源。',
  ) {
    super(message);
  }
}

export async function requestImageAccess(urls: string[]): Promise<void> {
  const request: ExportImageAccessRequest = { channel: 'asterveil:export-image-access', urls };
  const result: unknown = await browser.runtime.sendMessage(request);
  if (!isRecord(result) || result.ok !== true)
    throw new ImageAccessError(
      urls,
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : '图片授权失败，请重试。',
    );
}

async function readImage(url: string, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    signal.throwIfAborted();
    if (!isExportImageUrl(url)) throw new Error('图片读取失败，请检查链接后重试。');
    const request: ExportImageRequest = { channel: 'asterveil:export-image', url };
    const result: unknown = await browser.runtime.sendMessage(request);
    signal.throwIfAborted();
    if (isRecord(result) && result.ok === true && typeof result.dataUrl === 'string')
      return result.dataUrl;
    if (isRecord(result) && isExportImageUrl(result.permissionUrl))
      throw new ImageAccessError([result.permissionUrl]);
    throw new Error(
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : '图片读取失败，请重新加载扩展后重试。',
    );
  }
  return imageResponseData(response);
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片生成失败，请缩短内容后重试。'))),
      'image/png',
    ),
  );
}

export async function captureAnswer(preview: HTMLElement, signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  preview.getBoundingClientRect();
  await document.fonts.ready;
  const reads = new Map<string, Promise<string>>();
  const results = await Promise.allSettled(
    [...preview.querySelectorAll('img')].map(async (image) => {
      const responsive = image.hasAttribute('srcset') || image.closest('picture');
      const url = responsive ? image.currentSrc || image.src : image.src;
      try {
        let read = reads.get(url);
        if (!read) {
          read = readImage(url, bounded);
          reads.set(url, read);
        }
        const dataUrl = await read;
        // srcset and <picture> sources otherwise take precedence over embedded src.
        image.removeAttribute('srcset');
        image
          .closest('picture')
          ?.querySelectorAll('source')
          .forEach((source) => {
            source.remove();
          });
        image.loading = 'eager';
        image.src = dataUrl;
        await image.decode();
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ImageAccessError) throw error;
        const source = isExportImageUrl(url) ? new URL(url).host : '内嵌图片';
        throw new Error(`${source}：${error instanceof Error ? error.message : '图片无法解码。'}`);
      }
    }),
  );
  bounded.throwIfAborted();
  const missing = new Set<string>();
  let failure: unknown;
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    if (result.reason instanceof ImageAccessError) {
      for (const url of result.reason.urls) missing.add(url);
    } else failure ??= result.reason;
  }
  if (failure) throw failure;
  if (missing.size) throw new ImageAccessError([...missing]);
  const width = Math.ceil(preview.getBoundingClientRect().width);
  const height = Math.ceil(preview.scrollHeight);
  if (width * height * 4 > maxPixels || height * 2 > 30000) {
    throw new Error('内容过长，请分段导出（单张图片最多 3200 万像素）。');
  }
  const canvas = await toCanvas(preview, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    fontEmbedCSS: fontCss,
    width,
    height,
    style: { margin: '0', color: '#202632' },
  });
  signal.throwIfAborted();
  return canvas;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
