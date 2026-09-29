import { browser } from 'wxt/browser';
import type { Scope } from '../../core/scope';
import { requestSettings } from '../../platform/settings-client';
import { watchSettings } from '../../platform/settings-repository';
import { type ModuleId, moduleCatalog } from '../../shared/catalog';
import { isColorMode } from '../../shared/color-mode';
import { accentPresets, defaultAccentColor } from '../../shared/palette';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';
import { mountAvatarSettings } from './avatars';
import { mountHomeLayoutSettings } from './home-layout';

export function mountSettings(root: ParentNode, scope: Scope): void {
  function element<T extends HTMLElement>(id: string): T {
    const node = root.querySelector(`#${id}`);
    if (!node) throw new Error(`Missing element: ${id}`);
    return node as T;
  }

  const controls = element<HTMLFieldSetElement>('controls');
  const enabled = element<HTMLInputElement>('enabled');
  const list = element<HTMLDivElement>('modules');
  const status = element<HTMLParagraphElement>('status');
  const retry = element<HTMLButtonElement>('retry');
  const palette = element<HTMLFieldSetElement>('palette');
  const accentColor = element<HTMLInputElement>('accent-color');
  const colorMode = element<HTMLFieldSetElement>('color-mode');
  const modeInputs = Array.from(colorMode.querySelectorAll<HTMLInputElement>('input'));
  const presetInputs: HTMLInputElement[] = [];
  const inputs = new Map<ModuleId, HTMLInputElement>();
  let current: Settings | undefined;
  let pending = false;
  let pendingSaves = 0;
  let errorMessage = '';
  let storageChanges = 0;
  const homeLayout = mountHomeLayoutSettings(root, scope, save);
  let avatarControls: ReturnType<typeof mountAvatarSettings> | undefined;

  element('version').textContent = `v${browser.runtime.getManifest().version}`;
  element<HTMLFormElement>('settings-form').addEventListener(
    'submit',
    (event) => event.preventDefault(),
    { signal: scope.signal },
  );

  for (const module of moduleCatalog) {
    const label = document.createElement('label');
    label.className = 'module row settings-card';
    label.dataset.moduleId = module.id;
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = module.title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-checked', 'false');
    input.addEventListener(
      'change',
      () => {
        void save({ type: 'settings.module', moduleId: module.id, enabled: input.checked });
      },
      { signal: scope.signal },
    );
    text.append(title);
    if (module.description) {
      const description = document.createElement('small');
      description.textContent = module.description;
      text.append(description);
    }
    label.append(text, input);
    if (module.id === 'local-avatars') {
      const card = document.createElement('div');
      card.className = 'module settings-card';
      card.dataset.moduleId = module.id;
      label.className = 'row';
      card.append(label);
      avatarControls = mountAvatarSettings(card, scope, save);
      list.append(card);
    } else list.append(label);
    if (module.id === 'ui-polish') list.append(colorMode, palette);
    inputs.set(module.id, input);
  }

  for (const preset of accentPresets) {
    const label = document.createElement('label');
    label.className = 'swatch';
    label.style.setProperty('--swatch', preset.color);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'accent-preset';
    input.value = preset.color;
    input.setAttribute('aria-label', preset.name);
    const name = document.createElement('span');
    name.textContent = preset.name;
    input.addEventListener(
      'change',
      () => {
        void save({ type: 'settings.accent', color: preset.color });
      },
      { signal: scope.signal },
    );
    label.append(input, name);
    element('accent-presets').insertBefore(label, accentColor.parentElement);
    presetInputs.push(input);
  }

  for (const input of modeInputs) {
    input.addEventListener(
      'change',
      () => {
        if (isColorMode(input.value)) void save({ type: 'settings.color-mode', mode: input.value });
      },
      { signal: scope.signal },
    );
  }

  function updateSwatches(color: string): void {
    accentColor.title = color.toUpperCase();
    accentColor.parentElement?.style.setProperty('--swatch', color);
    for (const input of presetInputs) input.checked = input.value === color;
    accentColor.parentElement?.classList.toggle(
      'is-custom',
      !presetInputs.some((input) => input.checked),
    );
  }

  accentColor.addEventListener('input', () => updateSwatches(accentColor.value), {
    signal: scope.signal,
  });
  accentColor.addEventListener(
    'change',
    () => {
      void save({ type: 'settings.accent', color: accentColor.value });
    },
    { signal: scope.signal },
  );

  function render(): void {
    if (scope.signal.aborted) return;
    homeLayout.render(current);
    avatarControls?.render(current);
    controls.disabled = pending || !current;
    enabled.checked = current?.enabled ?? false;
    enabled.setAttribute('aria-checked', String(enabled.checked));
    for (const [id, input] of inputs) {
      input.checked = current?.modules[id] ?? false;
      input.setAttribute('aria-checked', String(input.checked));
      input.disabled = !current?.enabled;
    }
    palette.disabled = !current?.enabled || !current.modules['ui-polish'];
    for (const input of modeInputs) input.checked = input.value === (current?.colorMode ?? 'light');
    accentColor.value = current?.accentColor ?? defaultAccentColor;
    updateSwatches(accentColor.value);
    status.textContent = errorMessage || (current ? '' : '正在读取设置…');
    status.hidden = !status.textContent;
    status.classList.toggle('error', Boolean(errorMessage));
    retry.hidden = !errorMessage;
    retry.disabled = pending || pendingSaves > 0;
  }

  function reportError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : '无法读取设置，请重新加载扩展。';
    render();
  }

  async function load(): Promise<void> {
    if (scope.signal.aborted) return;
    pending = true;
    errorMessage = '';
    render();
    const initialChanges = storageChanges;
    try {
      const settings = await requestSettings({ type: 'settings.read' });
      if (storageChanges === initialChanges) current = settings;
    } catch (error) {
      reportError(error);
    } finally {
      pending = false;
      render();
    }
  }

  async function save(command: SettingsCommand): Promise<void> {
    if (scope.signal.aborted || !current) return;
    pendingSaves++;
    errorMessage = '';
    try {
      const settings = await requestSettings(command);
      if (!current || settings.revision >= current.revision) current = settings;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '保存失败，请重试。';
    } finally {
      pendingSaves--;
      if (pendingSaves === 0) render();
    }
  }

  const unwatch = watchSettings(
    (settings) => {
      storageChanges++;
      current = settings;
      if (pendingSaves === 0) {
        errorMessage = '';
        render();
      }
    },
    (error) => {
      storageChanges++;
      current = undefined;
      reportError(error);
    },
  );
  scope.defer(unwatch);
  enabled.addEventListener(
    'change',
    () => void save({ type: 'settings.enabled', enabled: enabled.checked }),
    { signal: scope.signal },
  );
  retry.addEventListener('click', () => void load(), { signal: scope.signal });
  void load();
}
