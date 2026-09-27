import { type ModuleId, moduleCatalog } from './catalog';

export const settingsKey = 'asterveil:settings';

export interface Settings {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly enabled: boolean;
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
  const modules = { ...defaultSettings().modules };
  for (const { id } of moduleCatalog) {
    const enabled = value.modules[id];
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new Error('模块设置数据无效。');
    }
    if (enabled !== undefined) modules[id] = enabled;
  }
  return { schemaVersion: 1, revision: value.revision, enabled: value.enabled, modules };
}
