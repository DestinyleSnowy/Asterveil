import type { FeatureModule } from '../../core/module';
import { enhanceAccountTables } from '../../site/account-tables';
import { appearancePage } from '../../site/appearance';
import { enhancePlans } from '../../site/plans';

export default {
  mount({ scope, url }) {
    const page = appearancePage(url);
    if (page === 'plans') enhancePlans(scope);
    if (page && ['account', 'account-rankings', 'account-data', 'account-schedule'].includes(page))
      enhanceAccountTables(scope);
  },
} satisfies FeatureModule;
