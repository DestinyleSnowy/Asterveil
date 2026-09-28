import { isModuleId, type ModuleId } from './catalog';
import { type ColorMode, isColorMode } from './color-mode';
import { isAccentColor } from './palette';
import { isRecord, type Settings } from './settings';

export type SettingsCommand =
  | { type: 'settings.read' }
  | { type: 'settings.enabled'; enabled: boolean }
  | { type: 'settings.accent'; color: string }
  | { type: 'settings.color-mode'; mode: ColorMode }
  | { type: 'settings.module'; moduleId: ModuleId; enabled: boolean };

export type SettingsRequest = SettingsCommand & { channel: 'asterveil' };
export type SettingsResponse = { ok: true; settings: Settings } | { ok: false; error: string };

export function isSettingsRequest(value: unknown): value is SettingsRequest {
  if (!isRecord(value) || value.channel !== 'asterveil') return false;
  switch (value.type) {
    case 'settings.read':
      return true;
    case 'settings.enabled':
      return typeof value.enabled === 'boolean';
    case 'settings.accent':
      return isAccentColor(value.color);
    case 'settings.color-mode':
      return isColorMode(value.mode);
    case 'settings.module':
      return typeof value.enabled === 'boolean' && isModuleId(value.moduleId);
    default:
      return false;
  }
}
