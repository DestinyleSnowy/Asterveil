import { characterAvatar } from './avatar-characters';

export const avatarStyles = [
  { id: 'mosaic', name: '几何方块' },
  { id: 'petals', name: '花瓣' },
  { id: 'monster', name: '小怪物' },
  { id: 'bird', name: '小团雀' },
  { id: 'cat', name: '猫咪' },
  { id: 'robot', name: '方脑袋' },
  { id: 'sprout', name: '小芽灵' },
] as const;
export type AvatarStyle = (typeof avatarStyles)[number]['id'];
export const defaultAvatarStyle: AvatarStyle = 'mosaic';

export function isAvatarStyle(value: unknown): value is AvatarStyle {
  return avatarStyles.some(({ id }) => id === value);
}

export const gravatarDomains = ['gravatar.com', 'gravatar.loli.net'] as const;

export function gravatarIdentity(source: string): string | undefined {
  let url: URL;
  try {
    url = new URL(source, 'https://jx.7fa4.cn:8888');
  } catch {
    return;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !gravatarDomains.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  )
    return;
  // Size/default-image parameters and mirror hosts must not change a person's avatar.
  return url.pathname.replace(/^\/(?:avatar|userimage)\//, '').toLowerCase() || 'default';
}

export function avatarDataUrl(identity: string, style: AvatarStyle = defaultAvatarStyle): string {
  let state = 2166136261;
  for (const char of identity) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const next = (max: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % max;
  };
  if (style !== 'mosaic' && style !== 'petals') {
    return svgDataUrl(characterAvatar(style, next));
  }
  const colors = [
    ['#e9effb', '#4779c4', '#98b9ed'],
    ['#e7f3eb', '#328c69', '#8bcdb2'],
    ['#f2eafa', '#9160c2', '#c8a5e8'],
    ['#f9e9ef', '#cc5b88', '#efa5c0'],
    ['#fbefdc', '#b97b25', '#edbe70'],
    ['#e2f1f3', '#278d98', '#8acdd3'],
  ] as const;
  const [background, accent, secondary] = colors[next(colors.length)] ?? colors[0];
  let shapes: string;
  if (style === 'petals') {
    const rotation = next(4) * 90;
    const petals = 4 + next(3);
    shapes = Array.from(
      { length: petals },
      (_, index) =>
        `<ellipse cx="32" cy="19" rx="8" ry="12" transform="rotate(${rotation + (index * 360) / petals} 32 32)" fill="${index % 2 ? secondary : accent}"/>`,
    ).join('');
    shapes += `<circle cx="32" cy="32" r="7" fill="${background}"/>`;
  } else {
    shapes = mosaic(next);
  }
  // All markup comes from fixed shapes and numeric seeds, never from the source URL.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${background}"/><g fill="${accent}">${shapes}</g></svg>`;
  return svgDataUrl(svg);
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function mosaic(next: (max: number) => number): string {
  const tiles: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 3; column++) {
      const tone = next(3);
      if (tone === 0 && !(row === 2 && column === 2)) continue;
      const columns = column === 2 ? [column] : [column, 4 - column];
      for (const mirrored of columns) {
        tiles.push(
          `<rect x="${8 + mirrored * 10}" y="${8 + row * 10}" width="8" height="8" rx="1.5" opacity="${tone === 2 ? 0.45 : 1}"/>`,
        );
      }
    }
  }
  return tiles.join('');
}
