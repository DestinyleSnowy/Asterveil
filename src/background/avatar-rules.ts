import { browser } from 'wxt/browser';
import type { Settings } from '../shared/settings';

export function createAvatarRuleService() {
  let queue: Promise<unknown> = Promise.resolve();
  let currentEnabled: boolean | undefined;
  return (settings: Settings) => {
    const enabled = settings.enabled && settings.modules['local-avatars'];
    const result = queue.then(async () => {
      if (currentEnabled === undefined) {
        const current = await browser.declarativeNetRequest.getEnabledRulesets();
        currentEnabled = current.includes('gravatar');
      }
      if (currentEnabled === enabled) return;
      await browser.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: enabled ? ['gravatar'] : [],
        disableRulesetIds: enabled ? [] : ['gravatar'],
      });
      currentEnabled = enabled;
    });
    queue = result.catch(() => {
      currentEnabled = undefined;
    });
    return result;
  };
}
