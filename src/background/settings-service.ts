import type { SettingsRepository } from '../platform/settings-repository';
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
