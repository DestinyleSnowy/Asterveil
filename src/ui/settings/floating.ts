import brandIcon from '../../../public/icon/asterveil.svg?raw';
import { Scope } from '../../core/scope';
import { type ColorMode, watchColorMode } from '../../shared/color-mode';
import { productName } from '../../shared/edition';
import { defaultAccentColor, paletteVariables } from '../../shared/palette';
import { mountSettings } from './controller';
import floatingCss from './floating.css?inline';
import { fillSettingsIcons, settingsIcon } from './icons';
import settingsCss from './style.css?inline';
import markup from './view.html?raw';

export function mountFloatingSettings(scope: Scope): {
  setAppearance(color: string, mode: ColorMode): void;
} {
  const host = document.createElement('div');
  host.dataset.asterveil = 'settings';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${settingsCss}\n${floatingCss}`;
  const launcher = document.createElement('button');
  launcher.className = 'settings-launcher';
  launcher.type = 'button';
  launcher.title = `${productName} 设置`;
  launcher.setAttribute('aria-label', `打开 ${productName} 设置`);
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = brandIcon;
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <div class="dialog-heading"><div class="dialog-identity"><span class="dialog-brand">${brandIcon}<span>${productName}</span></span><h2 id="settings-title">设置</h2></div><button type="button" class="dialog-close" aria-label="关闭设置">${settingsIcon('close')}</button></div>
    <div class="dialog-body">
      <nav class="settings-nav" aria-label="设置分类">
        <button type="button" data-section="appearance" aria-current="page">${settingsIcon('appearance')}外观配色</button>
        <button type="button" data-section="home">${settingsIcon('home')}首页布局</button>
        <button type="button" data-section="modules">${settingsIcon('modules')}功能模块</button>
        <button type="button" data-section="about">${settingsIcon('about')}关于</button>
      </nav>
      <div class="page-view">${markup.replaceAll('{{productName}}', productName)}</div>
    </div>`;
  const view = dialog.querySelector<HTMLElement>('.page-view');
  if (!view) throw new Error('Settings view missing');
  const emblem = view.querySelector('.emblem');
  if (emblem) emblem.innerHTML = brandIcon;
  fillSettingsIcons(view);
  let panelScope: Scope | undefined;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let dialogMotion: Animation | undefined;
  let pageMotion: Animation | undefined;
  let closing = false;
  const cancelDialogMotion = () => {
    if (dialogMotion) dialogMotion.onfinish = null;
    dialogMotion?.cancel();
    dialogMotion = undefined;
  };
  const close = () => {
    if (!dialog.open || closing) return;
    const { opacity, transform } = getComputedStyle(dialog);
    cancelDialogMotion();
    pageMotion?.cancel();
    if (reducedMotion.matches) {
      dialog.close();
      return;
    }
    closing = true;
    dialogMotion = dialog.animate(
      [
        { opacity, transform },
        { opacity: 0, transform: 'translateY(8px) scale(.985)' },
      ],
      { duration: 150, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
    );
    dialogMotion.onfinish = () => {
      dialog.close();
      cancelDialogMotion();
      closing = false;
    };
  };
  launcher.addEventListener(
    'click',
    () => {
      if (!panelScope) {
        panelScope = new Scope();
        mountSettings(view, panelScope);
      }
      if (dialog.open && !closing) return;
      cancelDialogMotion();
      closing = false;
      if (!dialog.open) dialog.showModal();
      launcher.setAttribute('aria-expanded', 'true');
      if (!reducedMotion.matches) {
        dialogMotion = dialog.animate(
          [
            { opacity: 0, transform: 'translateY(14px) scale(.975)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' },
        );
      }
    },
    { signal: scope.signal },
  );
  dialog.querySelector('.dialog-close')?.addEventListener('click', close, { signal: scope.signal });
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      close();
    },
    { signal: scope.signal },
  );
  dialog.addEventListener(
    'click',
    (event) => {
      const rect = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        close();
    },
    { signal: scope.signal },
  );
  dialog.addEventListener(
    'close',
    () => {
      if (dialog.open) return;
      cancelDialogMotion();
      pageMotion?.cancel();
      closing = false;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus({ preventScroll: true });
    },
    { signal: scope.signal },
  );
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('.settings-nav button')) {
    button.addEventListener(
      'click',
      () => {
        const settingsView = view.querySelector<HTMLElement>('.settings-view');
        if (!settingsView || closing || settingsView.dataset.section === button.dataset.section)
          return;
        pageMotion?.cancel();
        settingsView.dataset.section = button.dataset.section;
        view.scrollTop = 0;
        for (const item of dialog.querySelectorAll('.settings-nav button'))
          item.removeAttribute('aria-current');
        button.setAttribute('aria-current', 'page');
        if (!reducedMotion.matches) {
          pageMotion = settingsView.animate(
            [
              { opacity: 0, transform: 'translateY(7px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 190, easing: 'cubic-bezier(.16, 1, .3, 1)' },
          );
        }
      },
      { signal: scope.signal },
    );
  }
  shadow.append(style, launcher, dialog);
  document.body.append(host);
  let accent = defaultAccentColor;
  const setMode = watchColorMode(scope, (scheme) => {
    host.style.cssText = paletteVariables(accent, scheme);
  });
  const setAppearance = (color: string, mode: ColorMode) => {
    accent = color;
    setMode(mode);
  };
  setAppearance(defaultAccentColor, 'light');
  reducedMotion.addEventListener(
    'change',
    () => {
      if (!reducedMotion.matches) return;
      cancelDialogMotion();
      pageMotion?.cancel();
      if (closing) {
        dialog.close();
        closing = false;
      }
    },
    { signal: scope.signal },
  );
  scope.defer(() => {
    cancelDialogMotion();
    pageMotion?.cancel();
    panelScope?.dispose();
    if (dialog.open) dialog.close();
    host.remove();
  });
  return { setAppearance };
}
