import type { SettingsRepository } from '../platform/settings-repository';
import { defaultHomeLayout, moveHomeSection } from '../shared/home-layout';
import type { SettingsCommand } from '../shared/protocol';
import type { Settings } from '../shared/settings';

export function createSettingsService(repository: SettingsRepository) {
  // One writer prevents simultaneous settings panels from overwriting each other's fields.
  let queue: Promise<unknown> = Promise.resolve();

  return (command: SettingsCommand): Promise<Settings> => {
    const result = queue.then(async () => {
      const current = await repository.read();
      if (command.type === 'settings.read') return current;
      const next: Settings = {
        ...current,
        revision: current.revision + 1,
        enabled: command.type === 'settings.enabled' ? command.enabled : current.enabled,
        accentColor:
          command.type === 'settings.accent' ? command.color.toLowerCase() : current.accentColor,
        colorMode: command.type === 'settings.color-mode' ? command.mode : current.colorMode,
        avatarStyle: command.type === 'settings.avatar-style' ? command.style : current.avatarStyle,
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
