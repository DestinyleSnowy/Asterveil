import type { Scope } from '../core/scope';
import { watchColorMode } from '../shared/color-mode';
import { paletteVariables } from '../shared/palette';
import type { Settings } from '../shared/settings';
import accountCss from './account.css?inline';
import { appearancePage } from './appearance';
import css from './appearance.css?inline';
import chatCss from './chat.css?inline';
import codeEditorCss from './code-editor.css?inline';
import contestCss from './contest.css?inline';
import darkCss from './dark.css?inline';
import detailsCss from './details.css?inline';
import problemToolsCss from './problem-tools.css?inline';

// Pure CSS is installed at document_start; DOM enhancements wait until DOMContentLoaded.
export function createPageTheme(scope: Scope, initialUrl: URL) {
  const root = document.documentElement;
  const attributes = [
    'data-asterveil-appearance',
    'data-asterveil-page',
    'data-asterveil-scheme',
  ] as const;
  const previous = attributes.map((name) => root.getAttribute(name));
  const style = document.createElement('style');
  style.dataset.asterveil = 'ui-polish';
  style.textContent = `${css}\n${detailsCss}\n${contestCss}\n${problemToolsCss}\n${accountCss}\n${darkCss}\n${codeEditorCss}\n${chatCss}`;
  const palette = document.createElement('style');
  palette.dataset.asterveil = 'palette';
  root.append(style, palette);
  let active = false;
  let lastColor = '';
  let current: Settings | undefined;
  const setMode = watchColorMode(scope, (scheme) => {
    if (!active || !current) return;
    const key = `${current.accentColor}:${scheme}`;
    if (lastColor !== key) {
      palette.textContent = `html[data-asterveil-appearance="polished"] { ${paletteVariables(current.accentColor, scheme)} }\n@media print { html[data-asterveil-appearance="polished"] { ${paletteVariables(current.accentColor)} } }`;
      lastColor = key;
    }
    root.setAttribute('data-asterveil-scheme', scheme);
  });
  const restore = () => {
    if (!active) return;
    attributes.forEach((name, index) => {
      const value = previous[index];
      if (value == null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    });
    active = false;
  };

  // Prevent a frame in the site's original palette while local preferences arrive.
  // Fail open if storage is unavailable; never leave a page hidden indefinitely.
  const guard = document.createElement('style');
  guard.dataset.asterveil = 'initial-paint';
  guard.textContent = 'html[data-asterveil-loading] { visibility: hidden !important; }';
  const previousLoading = root.getAttribute('data-asterveil-loading');
  let pending = Boolean(appearancePage(initialUrl));
  if (pending) {
    root.setAttribute('data-asterveil-loading', '');
    root.append(guard);
  }
  const reveal = () => {
    if (!pending) return;
    pending = false;
    guard.remove();
    if (previousLoading === null) root.removeAttribute('data-asterveil-loading');
    else root.setAttribute('data-asterveil-loading', previousLoading);
  };
  const fallback = window.setTimeout(reveal, 800);
  scope.defer(() => {
    clearTimeout(fallback);
    reveal();
    restore();
    style.remove();
    palette.remove();
  });
  return {
    update(url: URL, settings: Settings | undefined) {
      if (scope.signal.aborted) return;
      current = settings;
      const page = appearancePage(url);
      if (page && settings?.enabled && settings.modules['ui-polish']) {
        root.setAttribute('data-asterveil-appearance', 'polished');
        root.setAttribute('data-asterveil-page', page);
        active = true;
        setMode(settings.colorMode);
      } else restore();
      clearTimeout(fallback);
      reveal();
    },
  };
}
