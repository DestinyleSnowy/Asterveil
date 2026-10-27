import type { FeatureModule } from '../../core/module';
import { enhanceProblemSource } from '../../site/problem-source';

export default {
  mount({ scope, url, settings }) {
    enhanceProblemSource(scope, url, settings.problemCopy);
  },
} satisfies FeatureModule;
