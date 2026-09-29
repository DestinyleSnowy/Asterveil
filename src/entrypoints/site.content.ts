import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { ModuleRuntime } from '../core/runtime';
import { Scope } from '../core/scope';
import { modules } from '../features/registry';
import { localSettings, watchSettings } from '../platform/settings-repository';
import { pdfEnabled } from '../shared/edition';
import { editionCheckMessage, editionStopMessage } from '../shared/edition-coordination';
import type { Settings } from '../shared/settings';
import { createHomeLayout } from '../site/home-layout';
import { contentMatches, resolveSite } from '../site/target';
import { createPageTheme } from '../site/theme';
import { mountFloatingSettings } from '../ui/settings/floating';

export default defineContentScript({
  matches: contentMatches,
  runAt: 'document_start',
  async main(ctx) {
    if (!resolveSite(new URL(location.href))) return;
    if (!pdfEnabled) {
      // Do not touch the DOM until the background has ruled out an enabled Pro.
      const allowed = await browser.runtime.sendMessage(editionCheckMessage).catch(() => false);
      if (allowed !== true || ctx.isInvalid) return;
    }
    const runtime = new ModuleRuntime(modules);
    const uiScope = new Scope();
    let floatingSettings: ReturnType<typeof mountFloatingSettings> | undefined;
    let theme: ReturnType<typeof createPageTheme> | undefined;
    let homeLayout: ReturnType<typeof createHomeLayout> | undefined;
    let domReady = false;
    let settingsResolved = false;
    const lifetime = new AbortController();
    let settings: Settings | undefined;
    let changes = 0;

    const reconcile = () => {
      if (ctx.isInvalid || lifetime.signal.aborted) return;
      const url = new URL(location.href);
      if (settingsResolved) theme?.update(url, settings);
      homeLayout?.update(url, settings);
      if (settings) {
        if (domReady) runtime.reconcile(url, settings);
        floatingSettings?.setAppearance(settings.accentColor, settings.colorMode);
      }
    };
    const initRoot = () => {
      if (theme || !document.documentElement || lifetime.signal.aborted) return;
      theme = createPageTheme(uiScope, new URL(location.href));
      reconcile();
    };
    const rootObserver = new MutationObserver(() => {
      initRoot();
      if (theme) rootObserver.disconnect();
    });
    initRoot();
    if (!theme) rootObserver.observe(document, { childList: true });
    uiScope.defer(() => rootObserver.disconnect());
    const initDom = () => {
      if (domReady || lifetime.signal.aborted || !document.body) return;
      domReady = true;
      initRoot();
      floatingSettings = mountFloatingSettings(uiScope);
      homeLayout = createHomeLayout(uiScope);
      reconcile();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDom, {
        once: true,
        signal: lifetime.signal,
      });
    } else initDom();
    const onError = (error: unknown) => {
      if (lifetime.signal.aborted) return;
      changes++;
      settings = undefined;
      settingsResolved = true;
      reconcile();
      runtime.stopAll();
      console.error('[Asterveil] Settings unavailable', error);
    };
    const unwatch = watchSettings((value) => {
      changes++;
      settings = value;
      settingsResolved = true;
      reconcile();
    }, onError);

    // Subscribe before reading, so an older initial read cannot replace a newer change.
    const initialChanges = changes;
    void localSettings.read().then(
      (value) => {
        if (lifetime.signal.aborted || changes !== initialChanges) return;
        settings = value;
        settingsResolved = true;
        reconcile();
      },
      (error: unknown) => {
        if (changes === initialChanges) onError(error);
      },
    );

    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    navigation?.addEventListener('currententrychange', reconcile, { signal: lifetime.signal });
    window.addEventListener('popstate', reconcile, { signal: lifetime.signal });
    window.addEventListener('hashchange', reconcile, { signal: lifetime.signal });
    window.addEventListener('pageshow', reconcile, { signal: lifetime.signal });

    const stop = () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      unwatch();
      runtime.dispose();
      uiScope.dispose();
    };
    if (!pdfEnabled) {
      const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
        message,
        sender,
        sendResponse,
      ) => {
        if (message !== editionStopMessage || sender.id !== browser.runtime.id || sender.tab) {
          return false;
        }
        stop();
        sendResponse(true);
        return false;
      };
      browser.runtime.onMessage.addListener(onMessage);
      uiScope.defer(() => browser.runtime.onMessage.removeListener(onMessage));
    }
    ctx.onInvalidated(stop);
    window.addEventListener(
      'pagehide',
      (event) => {
        if (!event.persisted) stop();
      },
      { signal: lifetime.signal },
    );
  },
});
