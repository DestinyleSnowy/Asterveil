import { type AvatarStyle, isAvatarStyle } from './avatar';
import { isBackgroundImage, isBackgroundOverlay } from './background';
import { isModuleId, type ModuleId } from './catalog';
import { type ColorMode, isColorMode } from './color-mode';
import { type HomeColumn, type HomeSectionId, isHomeColumn, isHomeSectionId } from './home-layout';
import { isAccentColor } from './palette';
import { isProblemCopyOption, type ProblemCopyOption } from './problem-copy';
import { isRecord, type Settings } from './settings';
import {
  isUserGradeKey,
  isUserGradePaletteMode,
  type UserGradeKey,
  type UserGradePaletteMode,
} from './user-name-palette';
import {
  isBuiltinUserNameSourceId,
  isUserNameSourceId,
  isUserNameSourceName,
  maxUserNameImportLength,
} from './user-name-sources';

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
  | { type: 'settings.problem-copy'; option: ProblemCopyOption; enabled: boolean }
  | { type: 'settings.user-names.import'; name: string; text: string; officialPassword?: string }
  | { type: 'settings.user-names.remove'; id: string }
  | { type: 'settings.user-names.source'; id: string; enabled: boolean }
  | { type: 'settings.user-names.palette.mode'; mode: UserGradePaletteMode }
  | { type: 'settings.user-names.palette.color'; grade: UserGradeKey; color: string }
  | { type: 'settings.user-names.palette.reset' }
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
    case 'settings.problem-copy':
      return isProblemCopyOption(value.option) && typeof value.enabled === 'boolean';
    case 'settings.user-names.import':
      return (
        isUserNameSourceName(value.name) &&
        typeof value.text === 'string' &&
        value.text.length <= maxUserNameImportLength &&
        (value.officialPassword === undefined ||
          (typeof value.officialPassword === 'string' && value.officialPassword.length <= 4096))
      );
    case 'settings.user-names.remove':
      return isUserNameSourceId(value.id);
    case 'settings.user-names.source':
      return (
        (isBuiltinUserNameSourceId(value.id) || isUserNameSourceId(value.id)) &&
        typeof value.enabled === 'boolean'
      );
    case 'settings.user-names.palette.mode':
      return isUserGradePaletteMode(value.mode);
    case 'settings.user-names.palette.color':
      return isUserGradeKey(value.grade) && isAccentColor(value.color);
    case 'settings.user-names.palette.reset':
      return true;
    default:
      return false;
  }
}
