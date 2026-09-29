import { PDFDocument } from 'pdf-lib';
import { canvasBlob } from './export';

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
