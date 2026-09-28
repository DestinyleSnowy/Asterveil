import type { FeatureModule } from '../../core/module';
import { enhanceAccountTables } from '../../site/account-tables';
import { appearancePage } from '../../site/appearance';
import { enhancePlans } from '../../site/plans';
import { enhanceProblemSource } from '../../site/problem-source';
import { enhanceProblemTitle } from '../../site/problem-title';

export default {
  mount({ scope, url }) {
    const page = appearancePage(url);
    if (page === 'problem') {
      enhanceProblemSource(scope, url);
      enhanceProblemTitle(scope);
    }
    if (page === 'plans') enhancePlans(scope);
    if (page && ['account', 'account-rankings', 'account-data', 'account-schedule'].includes(page))
      enhanceAccountTables(scope);
  },
} satisfies FeatureModule;
