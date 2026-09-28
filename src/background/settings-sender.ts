import { resolveSite } from '../site/target';

export function isSettingsSender(
  sender: {
    id?: string | undefined;
    url?: string | undefined;
    frameId?: number | undefined;
    tab?: { id?: number | undefined } | undefined;
  },
  extensionId: string,
): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  // Only this extension's top-frame content script on an exact target origin.
  if (sender.frameId !== 0 || sender.tab?.id === undefined) return false;
  try {
    return Boolean(resolveSite(new URL(sender.url)));
  } catch {
    return false;
  }
}
