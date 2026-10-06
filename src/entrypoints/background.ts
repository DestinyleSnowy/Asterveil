import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createAvatarRuleService } from '../background/avatar-rules';
import { createEditionPriority } from '../background/edition-priority';
import { isSettingsSender } from '../background/settings-sender';
import { createSettingsService } from '../background/settings-service';
import { createSubmitterService } from '../background/submitter-service';
import { createUpdaterService } from '../background/updater-service';
import { localSettings, watchSettings } from '../platform/settings-repository';
import { pdfEnabled } from '../shared/edition';
import { editionCheckMessage } from '../shared/edition-coordination';
import { isSettingsRequest, type SettingsResponse } from '../shared/protocol';
import { isUpdateRequest } from '../shared/updater';
import { isSubmitterRequest } from '../submitter/model';

export default defineBackground(() => {
  const checkEdition = pdfEnabled ? undefined : createEditionPriority();
  const ready = checkEdition ? checkEdition().catch(() => false) : Promise.resolve(true);
  const applyAvatarRules = createAvatarRuleService();
  const avatarRules: typeof applyAvatarRules = async (settings) => {
    if (await ready) await applyAvatarRules(settings);
  };
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
  let activeSubmissions = 0;
  const updater = createUpdaterService(() => activeSubmissions > 0);
  const popupUrl = browser.runtime.getURL('/popup.html');

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isUpdateRequest(message)) {
      if (!isSettingsSender(sender, browser.runtime.id)) return false;
      void updater(message).then(
        (state) => sendResponse({ ok: true, state }),
        () => sendResponse({ ok: false, error: '无法读取更新状态' }),
      );
      return true;
    }
    if (message === editionCheckMessage) {
      if (!isSettingsSender(sender, browser.runtime.id)) return false;
      void (checkEdition ? checkEdition() : ready).then(sendResponse, () => sendResponse(false));
      return true;
    }
    if (isSubmitterRequest(message)) {
      if (sender.id !== browser.runtime.id || sender.url !== popupUrl || sender.tab) return false;
      activeSubmissions++;
      void submitter(message)
        .then(sendResponse)
        .finally(() => {
          activeSubmissions--;
        });
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
