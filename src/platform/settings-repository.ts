import { browser } from 'wxt/browser';
import { decodeSettings, type Settings, settingsKey } from '../shared/settings';

export interface SettingsRepository {
  read(): Promise<Settings>;
  write(settings: Settings): Promise<void>;
}

export const localSettings: SettingsRepository = {
  async read() {
    const stored = await browser.storage.local.get(settingsKey);
    return decodeSettings(stored[settingsKey]);
  },
  async write(settings) {
    await browser.storage.local.set({ [settingsKey]: settings });
  },
};

export function watchSettings(
  onChange: (settings: Settings) => void,
  onError: (error: unknown) => void,
): () => void {
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, settingsKey)) return;
    try {
      onChange(decodeSettings(changes[settingsKey]?.newValue));
    } catch (error) {
      onError(error);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
