import type { ModuleDefinition } from '../core/module';

export const modules = [
  {
    id: 'keyboard-focus',
    matches: () => true,
    load: () => import('./keyboard-focus').then((module) => module.default),
  },
] satisfies readonly ModuleDefinition[];
