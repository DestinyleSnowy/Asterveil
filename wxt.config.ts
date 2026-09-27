import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  imports: false,
  manifest: {
    name: 'Asterveil',
    description: '以独立模块改善 7FA4 的视觉与操作体验。',
    minimum_chrome_version: '120',
    permissions: ['storage'],
    action: { default_title: 'Asterveil' },
  },
});
