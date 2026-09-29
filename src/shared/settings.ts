import { type AvatarStyle, defaultAvatarStyle, isAvatarStyle } from './avatar';
import { type ModuleId, moduleCatalog } from './catalog';
import { type ColorMode, isColorMode } from './color-mode';
import { decodeHomeLayout, defaultHomeLayout, type HomeLayout } from './home-layout';
import { accentPresets, defaultAccentColor, isAccentColor } from './palette';

export const settingsKey = 'asterveil:settings';

export interface Settings {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly enabled: boolean;
  readonly accentColor: string;
  readonly colorMode: ColorMode;
  readonly avatarStyle: AvatarStyle;
  readonly homeLayout: HomeLayout;
  readonly modules: Readonly<Record<ModuleId, boolean>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    revision: 0,
    enabled: true,
    accentColor: defaultAccentColor,
    colorMode: 'light',
    avatarStyle: defaultAvatarStyle,
    homeLayout: defaultHomeLayout(),
    modules: Object.fromEntries(
      moduleCatalog.map((item) => [item.id, item.defaultEnabled]),
    ) as Record<ModuleId, boolean>,
  };
}

export function decodeSettings(value: unknown): Settings {
  if (value === undefined || value === null) return defaultSettings();
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('设置版本不兼容，请使用匹配的 Asterveil 版本。');
  }
  if (
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.revision !== 'number' ||
    value.revision < 0 ||
    !isRecord(value.modules)
  ) {
    throw new Error('设置数据无效，未覆盖现有数据。');
  }
  const accentColor = value.accentColor ?? defaultAccentColor;
  if (!isAccentColor(accentColor)) throw new Error('主题颜色数据无效。');
  const normalizedAccent = accentColor.toLowerCase();
  // Stored presets use their hex value; carry existing selections into the refined palette.
  const preset = accentPresets.find((item) =>
    item.previousColors.some((color) => color === normalizedAccent),
  );
  const colorMode = value.colorMode ?? 'light';
  if (!isColorMode(colorMode)) throw new Error('显示模式数据无效。');
  const avatarStyle = value.avatarStyle ?? defaultAvatarStyle;
  if (!isAvatarStyle(avatarStyle)) throw new Error('头像样式数据无效。');
  const modules = { ...defaultSettings().modules };
  for (const { id } of moduleCatalog) {
    const enabled = value.modules[id];
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new Error('模块设置数据无效。');
    }
    if (enabled !== undefined) modules[id] = enabled;
  }
  return {
    schemaVersion: 1,
    revision: value.revision,
    enabled: value.enabled,
    accentColor: preset?.color ?? normalizedAccent,
    colorMode,
    avatarStyle,
    homeLayout: decodeHomeLayout(value.homeLayout),
    modules,
  };
}
