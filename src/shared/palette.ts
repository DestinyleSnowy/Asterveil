import type { ColorScheme } from './color-mode';

export const defaultAccentColor = '#3b82c4';

export const accentPresets = [
  { name: '雾蓝', color: defaultAccentColor, previousColors: ['#386b9e', '#4b7096'] },
  { name: '松绿', color: '#26926c', previousColors: ['#35785b', '#497561'] },
  { name: '鸢紫', color: '#9463ce', previousColors: ['#7657a6', '#786594'] },
  { name: '蔷薇', color: '#cf5683', previousColors: ['#ab536d', '#a35f76'] },
  { name: '琥珀', color: '#b98228', previousColors: ['#966b2e', '#947344'] },
  { name: '岩灰', color: '#78899f', previousColors: ['#596777', '#657180'] },
] as const;

export function isAccentColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
}

export function paletteVariables(color: string, scheme: ColorScheme = 'light'): string {
  if (!isAccentColor(color)) throw new Error('请选择有效的六位十六进制颜色。');
  const rgb = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  const mix = (base: number, weight: number) =>
    `rgb(${rgb.map((value) => Math.round(base + (value - base) * weight)).join(' ')})`;
  const luminance = (channels: number[]) =>
    channels.reduce((total, value, index) => {
      const channel = value / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return total + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
    }, 0);
  if (scheme === 'dark') {
    const background = luminance(rgb.map((value) => Math.round(30 + (value - 30) * 0.13)));
    let accentRgb = rgb;
    while ((luminance(accentRgb) + 0.05) / (background + 0.05) < 4.5) {
      accentRgb = accentRgb.map((value) => Math.ceil(value + (255 - value) * 0.06));
    }
    return `--av-scheme: dark; --av-solid: var(--av-accent); --av-accent: rgb(${accentRgb.join(' ')}); --av-canvas: ${mix(18, 0.035)}; --av-paper: ${mix(27, 0.035)}; --av-border: ${mix(58, 0.12)}; --av-tint: ${mix(30, 0.13)}; --av-surface: ${mix(32, 0.05)}; --av-hover: ${mix(38, 0.1)}; --av-heading: #edf0f5; --av-text: #d4dae3; --av-muted: #a3afbf; --av-on-accent: #111820; --av-icon: ${mix(210, 0.3)}; --av-focus: ${mix(220, 0.3)}; --av-ring: ${mix(35, 0.25)}; --av-danger: #ffabb6; --av-success: #89d9ae;`;
  }
  // Keep accent text at 4.5:1 against the selected navigation's tinted background.
  const background = luminance(rgb.map((value) => Math.round(255 + (value - 255) * 0.075)));
  let accentRgb = rgb;
  while ((background + 0.05) / (luminance(accentRgb) + 0.05) < 4.5) {
    accentRgb = accentRgb.map((value) => Math.floor(value * 0.96));
  }
  const accent = `rgb(${accentRgb.join(' ')})`;
  // Solid buttons can stay brighter than text on tinted navigation backgrounds.
  let solidRgb = rgb;
  while (1.05 / (luminance(solidRgb) + 0.05) < 4.5) {
    solidRgb = solidRgb.map((value) => Math.floor(value * 0.99));
  }
  const solid = `rgb(${solidRgb.join(' ')})`;
  return `--av-scheme: light; --av-paper: #fff; --av-text: #334155; --av-muted: #647184; --av-on-accent: #fff; --av-danger: #ad3549; --av-success: #35785b; --av-accent: ${accent}; --av-solid: ${solid}; --av-canvas: ${mix(255, 0.03)}; --av-border: ${mix(255, 0.12)}; --av-tint: ${mix(255, 0.075)}; --av-surface: ${mix(255, 0.02)}; --av-hover: ${mix(255, 0.04)}; --av-heading: ${mix(45, 0.28)}; --av-icon: ${mix(255, 0.7)}; --av-focus: ${mix(255, 0.7)}; --av-ring: ${mix(255, 0.15)};`;
}
