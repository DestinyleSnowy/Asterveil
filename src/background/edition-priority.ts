import { type Browser, browser } from 'wxt/browser';
import { editionStopMessage } from '../shared/edition-coordination';
import { contentMatches } from '../site/target';

// Unpacked installations have different IDs on different computers.
function isEnabledPro(info: Browser.management.ExtensionInfo): boolean {
  return (
    info.id !== browser.runtime.id &&
    info.type === 'extension' &&
    info.name === 'Asterveil Pro' &&
    info.enabled
  );
}

async function stopPages(): Promise<void> {
  const tabs = await browser.tabs.query({ url: contentMatches });
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined ? [] : [browser.tabs.sendMessage(tab.id, editionStopMessage)],
    ),
  );
}

export function createEditionPriority() {
  let blocked = false;
  let queue: Promise<unknown> = Promise.resolve();
  const reportError = (error: unknown) =>
    console.error('[Asterveil] Edition priority unavailable', error);

  const check = (): Promise<boolean> => {
    const result = queue.then(async () => {
      if (blocked) return false;
      if (!(await browser.management.getAll()).some(isEnabledPro)) return true;
      blocked = true;

      // Restore existing pages before invalidating their extension contexts.
      // A frozen/discarded tab must not prevent the extension from stopping.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          stopPages().catch(reportError),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 1000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      await browser.management.setEnabled(browser.runtime.id, false);
      return false;
    });
    queue = result.catch(reportError);
    return result;
  };

  const onExtensionChanged = (info: Browser.management.ExtensionInfo) => {
    if (isEnabledPro(info)) void check().catch(reportError);
  };
  // Register synchronously so MV3 can wake the worker when Pro starts later.
  browser.management.onEnabled.addListener(onExtensionChanged);
  browser.management.onInstalled.addListener(onExtensionChanged);
  return check;
}
