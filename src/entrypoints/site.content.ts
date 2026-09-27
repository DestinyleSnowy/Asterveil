import { defineContentScript } from 'wxt/utils/define-content-script';
import { ModuleRuntime } from '../core/runtime';
import { modules } from '../features/registry';
import { localSettings, watchSettings } from '../platform/settings-repository';
import type { Settings } from '../shared/settings';
import { contentMatches, resolveSite } from '../site/target';

export default defineContentScript({
  matches: contentMatches,
  runAt: 'document_idle',
  main(ctx) {
    if (!resolveSite(new URL(location.href))) return;
    const runtime = new ModuleRuntime(modules);
    const lifetime = new AbortController();
    let settings: Settings | undefined;
    let changes = 0;

    const reconcile = () => {
      if (!ctx.isInvalid && !lifetime.signal.aborted && settings) {
        runtime.reconcile(new URL(location.href), settings);
      }
    };
    const onError = (error: unknown) => {
      if (lifetime.signal.aborted) return;
      changes++;
      settings = undefined;
      runtime.stopAll();
      console.error('[Asterveil] Settings unavailable', error);
    };
    const unwatch = watchSettings((value) => {
      changes++;
      settings = value;
      reconcile();
    }, onError);

    // Subscribe before reading, so an older initial read cannot replace a newer change.
    const initialChanges = changes;
    void localSettings.read().then(
      (value) => {
        if (lifetime.signal.aborted || changes !== initialChanges) return;
        settings = value;
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
    };
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
