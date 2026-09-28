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

export function avatarDataUrl(identity: string): string {
  let state = 2166136261;
  for (const char of identity) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const next = (max: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % max;
  };
  const colors = [
    ['#e9effb', '#5474ac'],
    ['#e7f3eb', '#43826b'],
    ['#f2eafa', '#8966aa'],
    ['#f9e9ef', '#b76482'],
    ['#fbefdc', '#b78a43'],
    ['#e2f1f3', '#48878d'],
  ] as const;
  const [background, accent] = colors[next(colors.length)] ?? colors[0];
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${background}"/><g fill="${accent}">${tiles.join('')}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
