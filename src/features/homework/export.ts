import { fontCss } from 'virtual:homework-katex';
import { toCanvas } from 'html-to-image';

export const maxPixels = 32_000_000;

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
  await Promise.all(
    [...preview.querySelectorAll('img')].map(async (image) => {
      try {
        const response = await fetch(image.src, { signal: bounded, credentials: 'same-origin' });
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        image.src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await image.decode();
      } catch {
        throw new Error('有图片无法加载或不允许导出，请更换图片后重试。');
      }
    }),
  );
  signal.throwIfAborted();
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
