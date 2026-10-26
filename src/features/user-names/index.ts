import type { FeatureModule } from '../../core/module';
import { Scope } from '../../core/scope';
import { supplementUserRecords } from '../../shared/better-names-plan';
import { userNameEntryDatabase } from '../../shared/user-name-database';
import { activeUserNameRecords, type UserNameEntry } from '../../shared/user-name-sources';
import {
  remoteUserNameSourceIds,
  watchUserNameRemoteSource,
} from '../../site/user-name-remote-sources';
import { replaceUserNames } from '../../site/user-names';

export default {
  mount({ scope, url, settings }) {
    let mapping: Scope | undefined;
    const entries: Record<'official' | 'plan' | 'friends', readonly UserNameEntry[]> = {
      official: [],
      plan: [],
      friends: [],
    };
    scope.defer(() => mapping?.dispose());
    function render() {
      mapping?.dispose();
      mapping = new Scope();
      const official = userNameEntryDatabase(entries.official);
      let database: ReturnType<typeof activeUserNameRecords>;
      try {
        database = activeUserNameRecords(official.names, settings.userNames, official.grades);
      } catch {
        // Conflicting local sources can be removed from settings before rendering resumes.
        return;
      }
      const records = supplementUserRecords(
        supplementUserRecords(database, entries.plan),
        entries.friends,
      );
      replaceUserNames(
        mapping,
        url,
        new Map([...records].map(([id, record]) => [id, record.name])),
        {
          grades: new Map([...records].map(([id, record]) => [id, record.grade ?? 'uk'])),
          palette: settings.userNames.palette,
        },
      );
    }
    render();
    for (const kind of remoteUserNameSourceIds) {
      if (!settings.userNames.builtin[kind]) continue;
      watchUserNameRemoteSource(
        kind,
        scope,
        (state) => {
          if (entries[kind] === state.entries) return;
          entries[kind] = state.entries;
          render();
        },
        true,
      );
    }
  },
} satisfies FeatureModule;
