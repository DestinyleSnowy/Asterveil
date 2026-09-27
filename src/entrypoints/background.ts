import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createSettingsService } from '../background/settings-service';
import { localSettings } from '../platform/settings-repository';
import { isSettingsRequest, type SettingsResponse } from '../shared/protocol';

export default defineBackground(() => {
  const handle = createSettingsService(localSettings);
  const popupUrl = browser.runtime.getURL('/popup.html');

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isSettingsRequest(message)) return false;
    // Only our settings UI may issue commands. Web pages have no command bridge.
    if (sender.id !== browser.runtime.id || sender.url !== popupUrl) return false;

    void handle(message).then(
      (settings) => sendResponse({ ok: true, settings } satisfies SettingsResponse),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '设置操作失败。',
        } satisfies SettingsResponse),
    );
    return true;
  });
});
