import type { Scope } from '../../core/scope';
import { decodeBackgroundFile, encodeBackgroundImage } from '../../platform/background-image';
import { previewBackgroundOverlay } from '../../shared/background-preview';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';
import { chooseBackgroundCrop } from './background-crop';

export function mountBackgroundSettings(
  root: ParentNode,
  scope: Scope,
  save: (command: SettingsCommand) => Promise<void>,
) {
  function element<T extends HTMLElement>(id: string): T {
    const node = root.querySelector(`#${id}`);
    if (!node) throw new Error(`Missing element: ${id}`);
    return node as T;
  }
  const card = element<HTMLFieldSetElement>('background');
  const enabled = element<HTMLInputElement>('background-enabled');
  const file = element<HTMLInputElement>('background-file');
  const pick = element<HTMLButtonElement>('background-import');
  const remove = element<HTMLButtonElement>('background-remove');
  const overlay = element<HTMLInputElement>('background-overlay');
  const value = element<HTMLOutputElement>('background-overlay-value');
  const message = element<HTMLParagraphElement>('background-status');
  let current: Settings | undefined;
  let busy = false;
  let previewValue: number | undefined;
  let previewRevision = 0;
  scope.defer(() => previewBackgroundOverlay(undefined));

  function render(settings = current) {
    current = settings;
    if (scope.signal.aborted) return;
    const background = settings?.background;
    card.disabled = busy || !settings?.enabled || !settings.modules['ui-polish'];
    enabled.checked = background?.enabled ?? false;
    enabled.setAttribute('aria-checked', String(enabled.checked));
    enabled.disabled = !background?.image;
    remove.disabled = !background?.image;
    overlay.disabled = !background?.image || !background.enabled;
    overlay.value = String(previewValue ?? background?.overlay ?? 35);
    value.value = `${overlay.value}%`;
    pick.textContent = busy ? '正在处理…' : background?.image ? '更换图片' : '导入图片';
  }

  pick.addEventListener('click', () => file.click(), { signal: scope.signal });
  file.addEventListener(
    'change',
    async () => {
      const selected = file.files?.[0];
      file.value = '';
      if (!selected || busy) return;
      busy = true;
      message.hidden = true;
      render();
      try {
        const bitmap = await decodeBackgroundFile(selected);
        try {
          const crop = await chooseBackgroundCrop(root, scope, bitmap);
          if (crop && !scope.signal.aborted) {
            const image = encodeBackgroundImage(bitmap, crop);
            await save({ type: 'settings.background.image', image });
          }
        } finally {
          bitmap.close();
        }
      } catch (error) {
        if (!scope.signal.aborted) {
          message.textContent = error instanceof Error ? error.message : '图片导入失败，请重试。';
          message.hidden = false;
        }
      } finally {
        busy = false;
        render();
      }
    },
    { signal: scope.signal },
  );
  enabled.addEventListener(
    'change',
    () => void save({ type: 'settings.background.enabled', enabled: enabled.checked }),
    { signal: scope.signal },
  );
  remove.addEventListener(
    'click',
    () => {
      message.hidden = true;
      void save({ type: 'settings.background.image', image: null });
    },
    { signal: scope.signal },
  );
  overlay.addEventListener(
    'input',
    () => {
      value.value = `${overlay.value}%`;
      previewValue = Number(overlay.value);
      previewRevision++;
      previewBackgroundOverlay(previewValue);
    },
    { signal: scope.signal },
  );
  overlay.addEventListener(
    'change',
    async () => {
      const revision = previewRevision;
      await save({ type: 'settings.background.overlay', overlay: Number(overlay.value) });
      if (revision !== previewRevision) return;
      previewValue = undefined;
      previewBackgroundOverlay(undefined);
      render();
    },
    { signal: scope.signal },
  );
  return { render };
}
