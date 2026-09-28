import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createAvatarRuleService } from '../background/avatar-rules';
import { isSettingsSender } from '../background/settings-sender';
import { createSettingsService } from '../background/settings-service';
import { createSubmitterService } from '../background/submitter-service';
import { localSettings, watchSettings } from '../platform/settings-repository';
import { isSettingsRequest, type SettingsResponse } from '../shared/protocol';
import { isSubmitterRequest } from '../submitter/model';

export default defineBackground(() => {
  const avatarRules = createAvatarRuleService();
  const reportRuleError = (error: unknown) =>
    console.error('[Asterveil] Avatar rules unavailable', error);
  let settingsChanges = 0;
  watchSettings((settings) => {
    settingsChanges++;
    void avatarRules(settings).catch(reportRuleError);
  }, reportRuleError);
  const initialChanges = settingsChanges;
  void localSettings
    .read()
    .then((settings) => {
      if (settingsChanges === initialChanges) return avatarRules(settings);
    })
    .catch(reportRuleError);
  const handle = createSettingsService({
    read: localSettings.read,
    async write(settings) {
      settingsChanges++;
      // Apply network policy before content scripts receive the setting change.
      await avatarRules(settings);
      try {
        await localSettings.write(settings);
      } catch (error) {
        await avatarRules(await localSettings.read());
        throw error;
      }
    },
  });
  const submitter = createSubmitterService();
  const popupUrl = browser.runtime.getURL('/popup.html');

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isSubmitterRequest(message)) {
      if (sender.id !== browser.runtime.id || sender.url !== popupUrl || sender.tab) return false;
      void submitter(message).then(sendResponse);
      return true;
    }
    if (!isSettingsRequest(message)) return false;
    if (!isSettingsSender(sender, browser.runtime.id)) return false;

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
