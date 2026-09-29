import type { ModuleDefinition } from '../core/module';
import { matchesAppearancePage } from '../site/appearance';
import { matchesHomeworkPage } from '../site/homework';

export const modules = [
  {
    id: 'homework',
    matches: matchesHomeworkPage,
    load: () => import('./homework').then((module) => module.default),
  },
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
] satisfies readonly ModuleDefinition[];
