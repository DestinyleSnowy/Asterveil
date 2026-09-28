import { fontCss } from 'virtual:homework-katex';
import { toCanvas } from 'html-to-image';
import { PDFDocument } from 'pdf-lib';

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

export async function createPdf(canvas: HTMLCanvasElement): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const width = 595.28;
  const height = 841.89;
  const margin = 32;
  const scale = (width - margin * 2) / canvas.width;
  const pagePixels = Math.floor((height - margin * 2) / scale);
  for (let y = 0; y < canvas.height; ) {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.min(pagePixels, canvas.height - y);
    if (y + slice.height < canvas.height) {
      // Prefer whitespace near the page edge to avoid cutting a line or formula.
      const source = canvas.getContext('2d');
      const search = Math.floor(slice.height * 0.15);
      const bottom = y + slice.height;
      const pixels = source?.getImageData(0, bottom - search, canvas.width, search).data;
      if (pixels) {
        for (let row = search - 1; row >= 0; row--) {
          let blank = true;
          for (let x = 0; x < canvas.width; x++) {
            const offset = (row * canvas.width + x) * 4;
            if (
              (pixels[offset] ?? 0) < 245 ||
              (pixels[offset + 1] ?? 0) < 245 ||
              (pixels[offset + 2] ?? 0) < 245
            ) {
              blank = false;
              break;
            }
          }
          if (blank) {
            slice.height -= search - row;
            break;
          }
        }
      }
    }
    const context = slice.getContext('2d');
    if (!context) throw new Error('浏览器无法生成图片。');
    context.drawImage(canvas, 0, y, slice.width, slice.height, 0, 0, slice.width, slice.height);
    const image = await pdf.embedPng(await (await canvasBlob(slice)).arrayBuffer());
    pdf.addPage([width, height]).drawImage(image, {
      x: margin,
      y: height - margin - slice.height * scale,
      width: slice.width * scale,
      height: slice.height * scale,
    });
    y += slice.height;
    slice.width = slice.height = 0;
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
