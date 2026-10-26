import type { SettingsRepository } from '../platform/settings-repository';
import { defaultHomeLayout, moveHomeSection } from '../shared/home-layout';
import type { SettingsCommand } from '../shared/protocol';
import type { Settings } from '../shared/settings';
import type { OfficialUserNameDatabase } from '../shared/user-name-database';
import { defaultUserGradePalette, type UserGrade } from '../shared/user-name-palette';
import {
  importUserNameSource,
  removeUserNameSource,
  setUserNameSourceEnabled,
} from '../shared/user-name-sources';

export function createSettingsService(
  repository: SettingsRepository,
  officialNames:
    | ReadonlyMap<string, string>
    | ((command: SettingsCommand) => Promise<OfficialUserNameDatabase>),
  officialGrades: ReadonlyMap<string, UserGrade> = new Map(),
) {
  // One writer prevents simultaneous settings panels from overwriting each other's fields.
  let queue: Promise<unknown> = Promise.resolve();

  return (command: SettingsCommand): Promise<Settings> => {
    const result = queue.then(async () => {
      const current = await repository.read();
      if (command.type === 'settings.read') return current;
      let userNames = current.userNames;
      if (command.type === 'settings.user-names.import') {
        const official =
          typeof officialNames === 'function'
            ? await officialNames(command)
            : { names: officialNames, grades: officialGrades };
        userNames = importUserNameSource(
          userNames,
          command.name,
          command.text,
          official.names,
          official.grades,
        );
      } else if (command.type === 'settings.user-names.remove') {
        userNames = removeUserNameSource(userNames, command.id);
      } else if (command.type === 'settings.user-names.source') {
        userNames = setUserNameSourceEnabled(
          userNames,
          command.id,
          command.enabled,
          typeof officialNames === 'function' ? new Map() : officialNames,
          officialGrades,
        );
      } else if (command.type === 'settings.user-names.palette.mode') {
        if (userNames.palette.mode !== command.mode)
          userNames = {
            ...userNames,
            revision: userNames.revision + 1,
            palette: { ...userNames.palette, mode: command.mode },
          };
      } else if (command.type === 'settings.user-names.palette.color') {
        const color = command.color.toLowerCase();
        if (
          userNames.palette.colors[command.grade] !== color ||
          userNames.palette.mode !== 'custom'
        )
          userNames = {
            ...userNames,
            revision: userNames.revision + 1,
            palette: {
              mode: 'custom',
              colors: { ...userNames.palette.colors, [command.grade]: color },
            },
          };
      } else if (command.type === 'settings.user-names.palette.reset') {
        const palette = defaultUserGradePalette();
        if (JSON.stringify(userNames.palette) !== JSON.stringify(palette))
          userNames = { ...userNames, revision: userNames.revision + 1, palette };
      }
      if (command.type.startsWith('settings.user-names.') && userNames === current.userNames)
        return current;
      const next: Settings = {
        ...current,
        revision: current.revision + 1,
        userNames,
        enabled: command.type === 'settings.enabled' ? command.enabled : current.enabled,
        accentColor:
          command.type === 'settings.accent' ? command.color.toLowerCase() : current.accentColor,
        colorMode: command.type === 'settings.color-mode' ? command.mode : current.colorMode,
        avatarStyle: command.type === 'settings.avatar-style' ? command.style : current.avatarStyle,
        background:
          command.type === 'settings.background.image'
            ? { ...current.background, image: command.image, enabled: command.image !== null }
            : command.type === 'settings.background.enabled'
              ? { ...current.background, enabled: command.enabled }
              : command.type === 'settings.background.overlay'
                ? { ...current.background, overlay: command.overlay }
                : current.background,
        homeLayout:
          command.type === 'settings.home.reset'
            ? defaultHomeLayout()
            : command.type === 'settings.home.visible'
              ? current.homeLayout.map((item) =>
                  item.id === command.id ? { ...item, visible: command.visible } : item,
                )
              : command.type === 'settings.home.move'
                ? moveHomeSection(current.homeLayout, command.id, command.column, command.before)
                : current.homeLayout,
        modules:
          command.type === 'settings.module'
            ? { ...current.modules, [command.moduleId]: command.enabled }
            : current.modules,
      };
      await repository.write(next);
      return next;
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
