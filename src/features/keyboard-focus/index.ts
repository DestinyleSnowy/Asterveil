import type { FeatureModule } from '../../core/module';
import css from './style.css?inline';

export default {
  mount({ scope }) {
    const style = document.createElement('style');
    style.dataset.asterveil = 'keyboard-focus';
    style.textContent = css;
    scope.defer(() => style.remove());
    document.documentElement.append(style);
  },
} satisfies FeatureModule;
