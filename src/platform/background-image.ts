import { isBackgroundImage, maxBackgroundLength } from '../shared/background';
import type { CropRect } from '../shared/image-crop';

export async function decodeBackgroundFile(file: File): Promise<ImageBitmap> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB，请换一张较小的图片。');
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('无法读取这张图片，请确认文件完整或换一张图片。');
  }
}

export function encodeBackgroundImage(
  bitmap: ImageBitmap,
  crop: CropRect = { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
): string {
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > bitmap.width + 0.01 ||
    crop.y + crop.height > bitmap.height + 0.01
  )
    throw new Error('请选择有效的图片区域。');
  const scale = Math.min(1, 1920 / Math.max(crop.width, crop.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理图片，请重试。');
  context.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  for (const quality of [0.85, 0.65, 0.45]) {
    const image = canvas.toDataURL('image/webp', quality);
    if (image.length <= maxBackgroundLength && isBackgroundImage(image)) return image;
  }
  throw new Error('图片压缩后仍然过大，请换一张较小的图片。');
}

export async function importBackgroundImage(file: File): Promise<string> {
  const bitmap = await decodeBackgroundFile(file);
  try {
    return encodeBackgroundImage(bitmap);
  } finally {
    bitmap.close();
  }
}
