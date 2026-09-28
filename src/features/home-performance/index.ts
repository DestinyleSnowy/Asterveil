import type { FeatureModule } from '../../core/module';
import { enhanceHomePerformance } from '../../site/home-performance';

export default {
  mount({ scope, url }) {
    enhanceHomePerformance(scope, url);
  },
} satisfies FeatureModule;
