import { type Browser, browser } from 'wxt/browser';

export async function observeImageRedirects(
  url: string,
  onRedirect: (url: string) => void,
): Promise<() => void> {
  if (!(await browser.permissions.contains({ permissions: ['webRequest'] }))) return () => {};
  const urls = new Set([url.split('#')[0]]);
  const listener = (details: Browser.webRequest.OnBeforeRedirectDetails) => {
    if (
      details.tabId !== -1 ||
      details.initiator !== `chrome-extension://${browser.runtime.id}` ||
      !urls.has(details.url)
    )
      return;
    urls.add(details.redirectUrl.split('#')[0]);
    onRedirect(details.redirectUrl);
  };
  browser.webRequest.onBeforeRedirect.addListener(listener, {
    urls: ['http://*/*', 'https://*/*'],
    types: ['xmlhttprequest'],
  });
  return () => browser.webRequest.onBeforeRedirect.removeListener(listener);
}
