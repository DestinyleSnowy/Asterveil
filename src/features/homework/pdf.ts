import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
// PDF.js's in-process worker avoids remote scripts and content-script Worker origin restrictions.
import * as worker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { browser } from 'wxt/browser';
import { canvasBlob, maxPixels } from './export';

export async function pdfToImage(file: File, signal: AbortSignal): Promise<File> {
  if (file.size > 20 * 1024 * 1024) throw new Error('PDF 不能超过 20 MB。');
  const data = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(data.subarray(0, 5)) !== '%PDF-') {
    throw new Error('请选择有效的 PDF 文件。');
  }
  Object.assign(globalThis, { pdfjsWorker: worker });
  const asset = (directory: string) =>
    new URL(`pdfjs/${directory}/`, browser.runtime.getURL('/')).href;
  const task = getDocument({
    data,
    useSystemFonts: true,
    stopAtErrors: true,
    useWasm: false,
    cMapUrl: asset('cmaps'),
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
  });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw new Error('PDF 最多支持 20 页，请拆分后提交。');
    const pages = [];
    let height = 0;
    const width = 1400;
    for (let index = 1; index <= pdf.numPages; index++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      height += Math.ceil(viewport.height);
      if (height > 30000 || width * height > maxPixels) {
        throw new Error('PDF 页面总尺寸过大，请拆分后提交。');
      }
      pages.push({ page, viewport });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法生成答案图片。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    let top = 0;
    for (const { page, viewport } of pages) {
      signal.throwIfAborted();
      const part = document.createElement('canvas');
      part.width = width;
      part.height = Math.ceil(viewport.height);
      await page.render({ canvas: part, viewport, background: '#fff' }).promise;
      context.drawImage(part, 0, top);
      top += part.height;
      part.width = part.height = 0;
      page.cleanup();
    }
    signal.throwIfAborted();
    const blob = await canvasBlob(canvas);
    canvas.width = canvas.height = 0;
    return new File([blob], `${file.name.replace(/\.pdf$/i, '')}.png`, { type: 'image/png' });
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}
