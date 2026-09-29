const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  appearance:
    '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none"/>',
  modules:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  pipette:
    '<path d="m14 5 5 5m-4-6 1-1a2.1 2.1 0 0 1 3 3l-1 1 2 2-3 3-2-2-8 8-4 1 1-4 8-8-2-2 3-3Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
} as const;

export function settingsIcon(name: keyof typeof paths): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function fillSettingsIcons(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-settings-icon]')) {
    const name = element.dataset.settingsIcon;
    if (name && Object.hasOwn(paths, name))
      element.innerHTML = settingsIcon(name as keyof typeof paths);
  }
}
