import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createAvatarRuleService } from '../background/avatar-rules';
import {
  codeEditorLayoutTarget,
  refreshNativeCodeEditorLayout,
} from '../background/code-editor-layout';
import { createEditionPriority } from '../background/edition-priority';
import { fetchExportImage } from '../background/export-image';
import { observeImageRedirects } from '../background/image-redirects';
import { isSettingsSender } from '../background/settings-sender';
import { createSettingsService } from '../background/settings-service';
import { createSubmitterService } from '../background/submitter-service';
import { createUpdaterService } from '../background/updater-service';
import { createUserNameCache } from '../background/user-name-cache';
import { localSettings, watchSettings } from '../platform/settings-repository';
import { isCodeEditorLayoutRequest } from '../shared/code-editor';
import { pdfEnabled } from '../shared/edition';
import { editionCheckMessage } from '../shared/edition-coordination';
import {
  type ExportImageAccessResponse,
  type ExportImageResponse,
  imagePermissionOrigin,
  isExportImageAccessRequest,
  isExportImageRequest,
} from '../shared/export-image';
import { isSettingsRequest, type SettingsResponse } from '../shared/protocol';
import { isUpdateRequest } from '../shared/updater';
import { isUserNameCacheRequest, userNameCacheKey } from '../shared/user-name-cache';
import {
  decryptOfficialUserNames,
  officialUserNameDatabaseRevision,
  userNameEntryDatabase,
} from '../shared/user-name-database';
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
  const handle = createSettingsService(
    {
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
    },
    async (command) => {
      if (command.type !== 'settings.user-names.import' || !command.officialPassword)
        throw new Error('请先解锁官方数据源');
      return userNameEntryDatabase(await decryptOfficialUserNames(command.officialPassword));
    },
  );
  const submitter = createSubmitterService();
  let activeSubmissions = 0;
  const updater = createUpdaterService(() => activeSubmissions > 0);
  const popupUrl = browser.runtime.getURL('/popup.html');
  const nameCache = createUserNameCache(
    {
      read: async () => (await browser.storage.session.get(userNameCacheKey))[userNameCacheKey],
      write: (state) => browser.storage.session.set({ [userNameCacheKey]: state }),
    },
    `${browser.runtime.getManifest().version}:${officialUserNameDatabaseRevision}`,
    (client, notice) => {
      void browser.tabs
        .sendMessage(client.tabId, notice, { documentId: client.documentId })
        .catch(() => undefined);
    },
  );

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isUserNameCacheRequest(message)) {
      if (
        !isSettingsSender(sender, browser.runtime.id) ||
        !sender.documentId ||
        sender.tab?.id === undefined
      )
        return false;
      void nameCache(message, {
        origin: new URL(sender.url ?? '').origin,
        documentId: sender.documentId,
        tabId: sender.tab.id,
      }).then(sendResponse, () =>
        sendResponse({ ok: false, error: '会话缓存暂不可用', clearCache: false }),
      );
      return true;
    }
    if (isCodeEditorLayoutRequest(message)) {
      const target = codeEditorLayoutTarget(sender, browser.runtime.id);
      if (!target) return false;
      void browser.scripting
        .executeScript({
          target,
          world: 'MAIN',
          func: refreshNativeCodeEditorLayout,
          args: [message.fonts],
        })
        .then(
          (results) => sendResponse({ ok: true, available: results[0]?.result === true }),
          () => sendResponse({ ok: false }),
        );
      return true;
    }
    if (isExportImageAccessRequest(message)) {
      if (!isSettingsSender(sender, browser.runtime.id)) return false;
      // Request immediately to preserve the editor action's user gesture.
      void browser.permissions
        .request({
          permissions: ['webRequest'],
          origins: [...new Set(message.urls.map(imagePermissionOrigin))],
        })
        .then(
          (granted) =>
            sendResponse(
              granted ? { ok: true } : { ok: false, error: '未获图片来源授权，请授权后重试。' },
            ),
          (error: unknown) => {
            const needsGesture =
              error instanceof Error && /user (?:gesture|activation)/i.test(error.message);
            sendResponse({
              ok: false,
              error: needsGesture ? '请允许访问图片来源。' : '图片授权失败，请重试。',
              needsGesture,
            } satisfies ExportImageAccessResponse);
          },
        );
      return true;
    }
    if (isExportImageRequest(message)) {
      if (!isSettingsSender(sender, browser.runtime.id)) return false;
      void fetchExportImage(
        message.url,
        (origin) => browser.permissions.contains({ origins: [origin] }),
        observeImageRedirects,
      ).then(sendResponse, (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '图片读取失败，请重试。',
        } satisfies ExportImageResponse),
      );
      return true;
    }
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
