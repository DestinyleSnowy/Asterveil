export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CropPoint {
  x: number;
  y: number;
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export type CropHit = CropHandle | 'move' | 'new';

export function hitCrop(crop: CropRect, point: CropPoint, tolerance: number): CropHit {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  if (
    point.x < crop.x - tolerance ||
    point.x > right + tolerance ||
    point.y < crop.y - tolerance ||
    point.y > bottom + tolerance
  )
    return 'new';
  const horizontal =
    Math.abs(point.x - crop.x) <= tolerance
      ? 'w'
      : Math.abs(point.x - right) <= tolerance
        ? 'e'
        : '';
  const vertical =
    Math.abs(point.y - crop.y) <= tolerance
      ? 'n'
      : Math.abs(point.y - bottom) <= tolerance
        ? 's'
        : '';
  return (vertical + horizontal || 'move') as CropHit;
}

export function resizeCrop(
  crop: CropRect,
  handle: CropHandle,
  point: CropPoint,
  width: number,
  height: number,
  ratio = 0,
): CropRect {
  const anchor = {
    x: handle.includes('w') ? crop.x + crop.width : crop.x,
    y: handle.includes('n') ? crop.y + crop.height : crop.y,
  };
  if (handle.length === 2) return cropBetween(anchor, point, width, height, ratio);
  const horizontal = handle === 'e' || handle === 'w';
  const center = horizontal ? crop.y + crop.height / 2 : crop.x + crop.width / 2;
  if (horizontal) {
    let w = Math.abs(Math.max(0, Math.min(width, point.x)) - anchor.x);
    if (ratio > 0) w = Math.min(w, 2 * Math.min(center, height - center) * ratio);
    const h = ratio > 0 ? w / ratio : crop.height;
    return {
      x: point.x < anchor.x ? anchor.x - w : anchor.x,
      y: center - h / 2,
      width: w,
      height: h,
    };
  }
  let h = Math.abs(Math.max(0, Math.min(height, point.y)) - anchor.y);
  if (ratio > 0) h = Math.min(h, (2 * Math.min(center, width - center)) / ratio);
  const w = ratio > 0 ? h * ratio : crop.width;
  return {
    x: center - w / 2,
    y: point.y < anchor.y ? anchor.y - h : anchor.y,
    width: w,
    height: h,
  };
}

export function cropBetween(
  start: CropPoint,
  end: CropPoint,
  width: number,
  height: number,
  ratio = 0,
): CropRect {
  const sx = Math.max(0, Math.min(width, start.x));
  const sy = Math.max(0, Math.min(height, start.y));
  const ex = Math.max(0, Math.min(width, end.x));
  const ey = Math.max(0, Math.min(height, end.y));
  let w = Math.abs(ex - sx);
  let h = Math.abs(ey - sy);
  if (ratio > 0) {
    if (w / Math.max(h, 0.001) > ratio) w = h * ratio;
    else h = w / ratio;
  }
  return { x: ex < sx ? sx - w : sx, y: ey < sy ? sy - h : sy, width: w, height: h };
}

export function centeredCrop(width: number, height: number, ratio = 0): CropRect {
  const crop = cropBetween({ x: 0, y: 0 }, { x: width, y: height }, width, height, ratio);
  return { ...crop, x: (width - crop.width) / 2, y: (height - crop.height) / 2 };
}

export function moveCrop(
  crop: CropRect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): CropRect {
  return {
    ...crop,
    x: Math.max(0, Math.min(width - crop.width, crop.x + dx)),
    y: Math.max(0, Math.min(height - crop.height, crop.y + dy)),
  };
}
