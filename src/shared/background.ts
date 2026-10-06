// Keep the encoded image small enough to leave room for local drafts and settings.
export const maxBackgroundLength = 1_500_000;

export interface BackgroundSettings {
  readonly image: string | null;
  readonly enabled: boolean;
  readonly overlay: number;
}

export function defaultBackground(): BackgroundSettings {
  return { image: null, enabled: false, overlay: 35 };
}

export function isBackgroundImage(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= maxBackgroundLength &&
      /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
  );
}

export function isBackgroundOverlay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

export function decodeBackground(value: unknown): BackgroundSettings {
  if (value === undefined) return defaultBackground();
  if (typeof value !== 'object' || value === null) throw new Error('背景设置数据无效。');
  const background = value as Record<string, unknown>;
  if (
    !isBackgroundImage(background.image) ||
    typeof background.enabled !== 'boolean' ||
    !isBackgroundOverlay(background.overlay)
  ) {
    throw new Error('背景设置数据无效。');
  }
  return {
    image: background.image,
    enabled: background.enabled,
    overlay: background.overlay,
  };
}
