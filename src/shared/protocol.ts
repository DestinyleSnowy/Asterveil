import { type AvatarStyle, isAvatarStyle } from './avatar';
import { isBackgroundImage, isBackgroundOverlay } from './background';
import { isModuleId, type ModuleId } from './catalog';
import { type ColorMode, isColorMode } from './color-mode';
import { type HomeColumn, type HomeSectionId, isHomeColumn, isHomeSectionId } from './home-layout';
import { isAccentColor } from './palette';
import { isRecord, type Settings } from './settings';

export type SettingsCommand =
  | { type: 'settings.read' }
  | { type: 'settings.enabled'; enabled: boolean }
  | { type: 'settings.accent'; color: string }
  | { type: 'settings.color-mode'; mode: ColorMode }
  | { type: 'settings.avatar-style'; style: AvatarStyle }
  | { type: 'settings.background.image'; image: string | null }
  | { type: 'settings.background.enabled'; enabled: boolean }
  | { type: 'settings.background.overlay'; overlay: number }
  | { type: 'settings.home.visible'; id: HomeSectionId; visible: boolean }
  | {
      type: 'settings.home.move';
      id: HomeSectionId;
      column: HomeColumn;
      before: HomeSectionId | null;
    }
  | { type: 'settings.home.reset' }
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
    case 'settings.avatar-style':
      return isAvatarStyle(value.style);
    case 'settings.background.image':
      return isBackgroundImage(value.image);
    case 'settings.background.enabled':
      return typeof value.enabled === 'boolean';
    case 'settings.background.overlay':
      return isBackgroundOverlay(value.overlay);
    case 'settings.module':
      return typeof value.enabled === 'boolean' && isModuleId(value.moduleId);
    case 'settings.home.visible':
      return isHomeSectionId(value.id) && typeof value.visible === 'boolean';
    case 'settings.home.move':
      return (
        isHomeSectionId(value.id) &&
        isHomeColumn(value.column) &&
        (value.before === null || isHomeSectionId(value.before))
      );
    case 'settings.home.reset':
      return true;
    default:
      return false;
  }
}
