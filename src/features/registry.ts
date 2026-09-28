import type { ModuleDefinition } from '../core/module';
import { matchesAppearancePage } from '../site/appearance';

export const modules = [
  {
    id: 'ui-polish',
    matches: matchesAppearancePage,
    load: () => import('./ui-polish').then((module) => module.default),
  },
  {
    id: 'local-avatars',
    matches: () => true,
    load: () => import('./local-avatars').then((module) => module.default),
  },
  {
    id: 'keyboard-focus',
    matches: () => true,
    load: () => import('./keyboard-focus').then((module) => module.default),
  },
] satisfies readonly ModuleDefinition[];
