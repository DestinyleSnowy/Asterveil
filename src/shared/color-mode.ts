import type { Scope } from '../core/scope';

export type ColorMode = 'light' | 'dark' | 'system';
export type ColorScheme = Exclude<ColorMode, 'system'>;

export function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveColorMode(mode: ColorMode, systemDark: boolean): ColorScheme {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

export function watchColorMode(scope: Scope, render: (scheme: ColorScheme) => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let mode: ColorMode = 'light';
  const update = () => {
    if (!scope.signal.aborted) render(resolveColorMode(mode, media.matches));
  };
  media.addEventListener('change', update, { signal: scope.signal });
  return (value: ColorMode) => {
    mode = value;
    update();
  };
}
