import type { ModuleId } from '../shared/catalog';
import type { TargetSite } from '../site/target';
import type { Scope } from './scope';

export interface ModuleContext {
  readonly url: URL;
  readonly site: TargetSite;
  readonly scope: Scope;
}

export interface FeatureModule {
  mount(context: ModuleContext): void | Promise<void>;
}

export interface ModuleDefinition {
  readonly id: ModuleId;
  readonly matches: (url: URL) => boolean;
  readonly load: () => Promise<FeatureModule>;
}
