import type { Scope } from '../../core/scope';
import {
  defaultProblemCopySettings,
  type ProblemCopyOption,
  problemCopyOptions,
} from '../../shared/problem-copy';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';

export function mountProblemCopySettings(
  card: HTMLElement,
  scope: Scope,
  save: (command: SettingsCommand) => Promise<void>,
) {
  const controls = document.createElement('fieldset');
  controls.className = 'problem-copy-options';
  controls.setAttribute('aria-label', '复制题面选项');
  const labels: Record<ProblemCopyOption, string> = {
    source: '显示复制源码',
    description: '显示复制描述',
    hideOriginal: '隐藏原站源码',
  };
  const accessibleLabels: Record<ProblemCopyOption, string> = {
    source: '显示复制源码按钮',
    description: '显示复制题目描述按钮',
    hideOriginal: '隐藏原站题面源码按钮',
  };
  const inputs = new Map<ProblemCopyOption, HTMLInputElement>();
  for (const option of problemCopyOptions) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', accessibleLabels[option]);
    input.dataset.problemCopy = option;
    const title = document.createElement('span');
    title.textContent = labels[option];
    input.addEventListener(
      'change',
      () => {
        input.setAttribute('aria-checked', String(input.checked));
        void save({ type: 'settings.problem-copy', option, enabled: input.checked });
      },
      { signal: scope.signal },
    );
    label.append(input, title);
    controls.append(label);
    inputs.set(option, input);
  }
  card.append(controls);
  return {
    render(settings: Settings | undefined) {
      controls.disabled = !settings?.enabled || !settings.modules['problem-copy'];
      const current = settings?.problemCopy ?? defaultProblemCopySettings();
      for (const [option, input] of inputs) {
        input.checked = current[option];
        input.setAttribute('aria-checked', String(input.checked));
      }
    },
  };
}
