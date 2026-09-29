import type { ModuleId } from '../shared/catalog';
import type { Settings } from '../shared/settings';
import type { TargetSite } from '../site/target';
import type { Scope } from './scope';

export interface ModuleContext {
  readonly url: URL;
  readonly site: TargetSite;
  readonly scope: Scope;
  readonly settings: Settings;
}

export interface FeatureModule {
  mount(context: ModuleContext): void | Promise<void>;
}

export interface ModuleDefinition {
  readonly id: ModuleId;
  readonly configurationKey?: (settings: Settings) => string;
  readonly matches: (url: URL) => boolean;
  readonly load: () => Promise<FeatureModule>;
}
