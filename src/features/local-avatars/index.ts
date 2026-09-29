import type { FeatureModule } from '../../core/module';
import { replaceGravatarImages } from '../../site/avatars';

export default {
  mount({ scope, settings }) {
    replaceGravatarImages(scope, settings.avatarStyle);
  },
} satisfies FeatureModule;
