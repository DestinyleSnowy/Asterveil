import type { Scope } from '../../core/scope';
import { isAccentColor } from '../../shared/palette';
import type { SettingsCommand } from '../../shared/protocol';
import type { Settings } from '../../shared/settings';
import {
  defaultUserGradePalette,
  isUserGradePaletteMode,
  type UserGradeKey,
  userGradeColor,
  userGradeGroups,
  userGradeLabel,
} from '../../shared/user-name-palette';

export function mountUserNamePalette(
  root: ParentNode,
  scope: Scope,
  save: (command: SettingsCommand) => Promise<Settings>,
) {
  function element<T extends HTMLElement>(id: string): T {
    const node = root.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing element: ${id}`);
    return node;
  }
  const grid = element<HTMLDivElement>('user-grade-colors');
  const resetSlot = element<HTMLSpanElement>('user-grade-palette-reset-slot');
  const reset = element<HTMLButtonElement>('user-grade-palette-reset');
  const status = element<HTMLParagraphElement>('user-grade-status');
  const modes = [...root.querySelectorAll<HTMLInputElement>('[name="user-grade-palette-mode"]')];
  const cells = new Map<
    UserGradeKey,
    { label: HTMLLabelElement; picker: HTMLInputElement; hex: HTMLInputElement; synced: string }
  >();
  const invalid = new Set<UserGradeKey>();
  const drafts = new Map<UserGradeKey, string>();
  const pendingColors = new Map<UserGradeKey, string>();
  let colorTimer: ReturnType<typeof setTimeout> | undefined;
  let colorSave: Promise<void> | undefined;
  let current: Settings | undefined;
  let busy = false;
  let saveError = '';

  function renderStatus() {
    const first = invalid.values().next().value;
    status.textContent =
      saveError || (first ? `${userGradeLabel(first)}：颜色须为 6 位十六进制值` : '');
    status.hidden = !status.textContent;
  }
  function updateCells() {
    const palette = current?.userNames.palette ?? defaultUserGradePalette();
    const custom = palette.mode === 'custom';
    for (const [key, cell] of cells) {
      const color =
        (custom ? drafts.get(key) : undefined) ?? userGradeColor(key, palette) ?? '#000000';
      cell.label.style.color = color;
      cell.picker.disabled = cell.hex.disabled = busy || !current || !custom;
      const next = `${custom}:${color}`;
      if (cell.synced !== next) {
        cell.synced = next;
        cell.picker.value = color;
        const active = (cell.hex.getRootNode() as Document | ShadowRoot).activeElement;
        if (!custom || active !== cell.hex) {
          cell.hex.value = color.toUpperCase();
          cell.hex.removeAttribute('aria-invalid');
          invalid.delete(key);
        }
      }
    }
    renderStatus();
  }
  function render(settings = current) {
    if (scope.signal.aborted) return;
    if (!current || (settings && settings.revision >= current.revision)) current = settings;
    const palette = current?.userNames.palette ?? defaultUserGradePalette();
    for (const input of modes) {
      input.checked = input.value === palette.mode;
      input.disabled = busy || !current;
    }
    const custom = palette.mode === 'custom';
    resetSlot.classList.toggle('is-visible', custom);
    resetSlot.inert = !custom;
    resetSlot.setAttribute('aria-hidden', String(!custom));
    reset.disabled =
      busy ||
      !current ||
      !custom ||
      JSON.stringify(palette) === JSON.stringify(defaultUserGradePalette());
    updateCells();
  }
  function flushColors(): Promise<void> {
    clearTimeout(colorTimer);
    colorTimer = undefined;
    if (colorSave) return colorSave;
    if (scope.signal.aborted || !pendingColors.size) return Promise.resolve();
    colorSave = (async () => {
      while (!scope.signal.aborted && pendingColors.size) {
        const entry = pendingColors.entries().next().value;
        if (!entry) break;
        const [grade, color] = entry;
        pendingColors.delete(grade);
        try {
          const settings = await save({ type: 'settings.user-names.palette.color', grade, color });
          if (scope.signal.aborted) return;
          if (drafts.get(grade) === color && !pendingColors.has(grade)) drafts.delete(grade);
          saveError = '';
          render(settings);
        } catch (error) {
          if (scope.signal.aborted) return;
          saveError = error instanceof Error ? error.message : '配色保存失败';
          renderStatus();
        }
      }
    })().finally(() => {
      colorSave = undefined;
    });
    return colorSave;
  }
  function queueColor(grade: UserGradeKey, color: string) {
    const normalized = color.toLowerCase();
    drafts.set(grade, normalized);
    pendingColors.set(grade, normalized);
    invalid.delete(grade);
    cells.get(grade)?.hex.removeAttribute('aria-invalid');
    saveError = '';
    render();
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => void flushColors(), 120);
  }
  scope.defer(() => {
    clearTimeout(colorTimer);
    pendingColors.clear();
  });
  async function commit(command: SettingsCommand) {
    if (busy || !current) return;
    const controlRoot = reset.getRootNode() as Document | ShadowRoot;
    const focusedMode = modes.find((input) => input === controlRoot.activeElement);
    saveError = '';
    busy = true;
    render();
    try {
      await flushColors();
      if (scope.signal.aborted) return;
      drafts.clear();
      const settings = await save(command);
      if (!scope.signal.aborted) {
        saveError = '';
        render(settings);
      }
    } catch (error) {
      if (!scope.signal.aborted)
        saveError = error instanceof Error ? error.message : '配色保存失败';
    } finally {
      busy = false;
      for (const cell of cells.values()) cell.synced = '';
      render();
      if (
        focusedMode &&
        !scope.signal.aborted &&
        (!controlRoot.activeElement || controlRoot.activeElement === document.body)
      )
        focusedMode.focus({ preventScroll: true });
    }
  }
  for (const [index, group] of userGradeGroups.entries()) {
    const row = document.createElement('section');
    row.className = 'name-grade-group';
    const heading = document.createElement('h3');
    heading.id = `user-grade-group-${index}`;
    heading.textContent = group.label;
    row.setAttribute('aria-labelledby', heading.id);
    const cohorts = document.createElement('div');
    cohorts.className = 'name-grade-cohorts';
    for (const key of group.keys) {
      const fullName = userGradeLabel(key);
      const cell = document.createElement('div');
      cell.className = 'name-grade-cell';
      cell.dataset.grade = key;
      const label = document.createElement('label');
      label.className = 'name-grade-label';
      label.htmlFor = `user-grade-${key}`;
      label.textContent = fullName.replace(/^[小初高大](?=\d)/, '');
      const inputs = document.createElement('div');
      inputs.className = 'name-grade-inputs';
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.id = label.htmlFor;
      picker.setAttribute('aria-label', `${fullName}颜色`);
      const hex = document.createElement('input');
      hex.type = 'text';
      hex.id = `user-grade-hex-${key}`;
      hex.maxLength = 7;
      hex.spellcheck = false;
      hex.autocomplete = 'off';
      hex.setAttribute('aria-label', `${fullName}十六进制颜色`);
      hex.setAttribute('aria-describedby', status.id);
      hex.addEventListener(
        'input',
        () => {
          if (hex.disabled || busy) return;
          const color = `#${hex.value.trim().replace(/^#/, '')}`;
          invalid.delete(key);
          hex.removeAttribute('aria-invalid');
          saveError = '';
          if (isAccentColor(color)) queueColor(key, color);
          else {
            pendingColors.delete(key);
            drafts.delete(key);
            updateCells();
          }
        },
        { signal: scope.signal },
      );
      hex.addEventListener(
        'change',
        () => {
          if (hex.disabled || busy) return;
          const color = `#${hex.value.trim().replace(/^#/, '')}`;
          if (!isAccentColor(color)) {
            invalid.add(key);
            hex.setAttribute('aria-invalid', 'true');
            saveError = '';
            renderStatus();
            return;
          }
          hex.value = color.toUpperCase();
          queueColor(key, color);
          void flushColors();
        },
        { signal: scope.signal },
      );
      hex.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            hex.dispatchEvent(new Event('change'));
          }
        },
        { signal: scope.signal },
      );
      picker.addEventListener(
        'input',
        () => {
          if (picker.disabled || busy) return;
          queueColor(key, picker.value);
        },
        { signal: scope.signal },
      );
      picker.addEventListener(
        'change',
        () => {
          if (picker.disabled || busy) return;
          queueColor(key, picker.value);
          void flushColors();
        },
        { signal: scope.signal },
      );
      inputs.append(picker, hex);
      cell.append(label, inputs);
      cells.set(key, { label, picker, hex, synced: '' });
      cohorts.append(cell);
    }
    row.append(heading, cohorts);
    grid.append(row);
  }
  for (const input of modes)
    input.addEventListener(
      'change',
      () => {
        if (isUserGradePaletteMode(input.value))
          void commit({ type: 'settings.user-names.palette.mode', mode: input.value });
      },
      { signal: scope.signal },
    );
  reset.addEventListener(
    'click',
    () => {
      void commit({ type: 'settings.user-names.palette.reset' });
    },
    { signal: scope.signal },
  );
  return { render };
}
