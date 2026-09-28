import type { FeatureModule } from '../../core/module';
import { replaceGravatarImages } from '../../site/avatars';

export default {
  mount({ scope }) {
    replaceGravatarImages(scope);
  },
} satisfies FeatureModule;
