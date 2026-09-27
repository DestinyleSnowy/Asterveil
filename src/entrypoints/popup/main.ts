import { browser } from 'wxt/browser';
import { requestSettings } from '../../platform/settings-client';
import { watchSettings } from '../../platform/settings-repository';
import { type ModuleId, moduleCatalog } from '../../shared/catalog';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const controls = element<HTMLFieldSetElement>('controls');
const enabled = element<HTMLInputElement>('enabled');
const list = element<HTMLDivElement>('modules');
const status = element<HTMLParagraphElement>('status');
const retry = element<HTMLButtonElement>('retry');
const inputs = new Map<ModuleId, HTMLInputElement>();
let current: Settings | undefined;
let pending = false;
let errorMessage = '';
let storageChanges = 0;

element('version').textContent = `v${browser.runtime.getManifest().version}`;
element<HTMLFormElement>('settings-form').addEventListener('submit', (event) =>
  event.preventDefault(),
);

for (const module of moduleCatalog) {
  const label = document.createElement('label');
  label.className = 'module row';
  const text = document.createElement('span');
  const title = document.createElement('strong');
  const description = document.createElement('small');
  title.textContent = module.title;
  description.textContent = module.description;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-checked', 'false');
  input.addEventListener('change', () => {
    void save({ type: 'settings.module', moduleId: module.id, enabled: input.checked });
  });
  text.append(title, description);
  label.append(text, input);
  list.append(label);
  inputs.set(module.id, input);
}

function render(): void {
  controls.disabled = pending || !current;
  enabled.checked = current?.enabled ?? false;
  enabled.setAttribute('aria-checked', String(enabled.checked));
  for (const [id, input] of inputs) {
    input.checked = current?.modules[id] ?? false;
    input.setAttribute('aria-checked', String(input.checked));
    input.disabled = !current?.enabled;
  }
  status.textContent =
    errorMessage ||
    (pending
      ? current
        ? '正在保存…'
        : '正在读取设置…'
      : current?.enabled
        ? '设置已生效 · 在目标网站启用所选模块'
        : current
          ? '已暂停 · 保留你的模块偏好'
          : '正在读取设置…');
  status.classList.toggle('error', Boolean(errorMessage));
  retry.hidden = !errorMessage;
  retry.disabled = pending;
}

function reportError(error: unknown): void {
  errorMessage = error instanceof Error ? error.message : '无法读取设置，请重新加载扩展。';
  render();
}

async function load(): Promise<void> {
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
  if (pending || !current) return;
  pending = true;
  errorMessage = '';
  render();
  try {
    const settings = await requestSettings(command);
    if (!current || settings.revision >= current.revision) current = settings;
  } catch (error) {
    reportError(error);
  } finally {
    pending = false;
    render();
  }
}

const unwatch = watchSettings(
  (settings) => {
    storageChanges++;
    current = settings;
    errorMessage = '';
    render();
  },
  (error) => {
    storageChanges++;
    current = undefined;
    reportError(error);
  },
);
window.addEventListener('pagehide', unwatch, { once: true });
enabled.addEventListener(
  'change',
  () => void save({ type: 'settings.enabled', enabled: enabled.checked }),
);
retry.addEventListener('click', () => void load());
void load();
