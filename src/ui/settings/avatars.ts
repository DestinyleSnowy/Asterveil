import type { Scope } from '../../core/scope';
import {
  type AvatarStyle,
  avatarDataUrl,
  avatarStyles,
  defaultAvatarStyle,
} from '../../shared/avatar';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';

// Curated preview identities show the available palette range instead of one repeated color.
const previewVariants: Record<AvatarStyle, number> = {
  mosaic: 0,
  petals: 4,
  monster: 16,
  bird: 6,
  cat: 0,
  robot: 9,
  sprout: 20,
};

export function mountAvatarSettings(
  card: HTMLElement,
  scope: Scope,
  save: (command: SettingsCommand) => Promise<void>,
) {
  const controls = document.createElement('fieldset');
  controls.className = 'avatar-options';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '头像样式';
  controls.append(legend);
  const inputs: HTMLInputElement[] = [];
  for (const style of avatarStyles) {
    const label = document.createElement('label');
    label.className = 'avatar-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'avatar-style';
    input.value = style.id;
    const image = document.createElement('img');
    image.src = avatarDataUrl(
      `asterveil-preview-${style.id}-${previewVariants[style.id]}`,
      style.id,
    );
    image.alt = '';
    image.width = 48;
    image.height = 48;
    const name = document.createElement('span');
    name.textContent = style.name;
    input.addEventListener(
      'change',
      () => {
        if (input.checked) void save({ type: 'settings.avatar-style', style: style.id });
      },
      { signal: scope.signal },
    );
    label.append(input, image, name);
    controls.append(label);
    inputs.push(input);
  }
  controls.title = '每位用户的配色与图案保持固定';
  card.append(controls);
  return {
    render(settings: Settings | undefined) {
      controls.disabled = !settings?.enabled || !settings.modules['local-avatars'];
      for (const input of inputs)
        input.checked = input.value === (settings?.avatarStyle ?? defaultAvatarStyle);
    },
  };
}
