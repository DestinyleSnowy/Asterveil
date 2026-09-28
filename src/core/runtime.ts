import type { ModuleId } from '../shared/catalog';
import type { Settings } from '../shared/settings';
import { resolveSite } from '../site/target';
import type { ModuleDefinition } from './module';
import { Scope } from './scope';

export class ModuleRuntime {
  private readonly active = new Map<ModuleId, Scope>();
  private pageUrl = '';
  private disposed = false;

  constructor(private readonly definitions: readonly ModuleDefinition[]) {
    if (new Set(definitions.map(({ id }) => id)).size !== definitions.length) {
      throw new Error('Duplicate Asterveil module IDs');
    }
  }

  reconcile(url: URL, settings: Settings): void {
    if (this.disposed) return;
    if (this.pageUrl !== url.href) {
      this.stopAll();
      this.pageUrl = url.href;
    }
    const site = resolveSite(url);
    for (const definition of this.definitions) {
      try {
        const shouldRun =
          site && settings.enabled && settings.modules[definition.id] && definition.matches(url);
        if (!shouldRun) {
          this.stop(definition.id);
          continue;
        }
        if (this.active.has(definition.id)) continue;
        const scope = new Scope();
        this.active.set(definition.id, scope);
        // A disable/navigation during loading must never mount a stale module.
        void Promise.resolve()
          .then(async () => {
            if (scope.signal.aborted) return;
            const module = await definition.load();
            if (!scope.signal.aborted) {
              return module.mount({ url: new URL(url), site, scope, settings });
            }
          })
          .catch((error: unknown) => {
            if (scope.signal.aborted) return;
            console.error(`[Asterveil] Module ${definition.id} failed`, error);
            if (this.active.get(definition.id) === scope) this.stop(definition.id);
          });
      } catch (error) {
        this.stop(definition.id);
        console.error(`[Asterveil] Module ${definition.id} failed`, error);
      }
    }
  }

  stopAll(): void {
    for (const id of this.active.keys()) this.stop(id);
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
  }

  private stop(id: ModuleId): void {
    const active = this.active.get(id);
    this.active.delete(id);
    active?.dispose();
  }
}
