import { defineConfig } from 'wxt';

const icons = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  128: 'icon/128.png',
};

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  imports: false,
  manifest: {
    name: 'Asterveil',
    description: '以独立模块改善 7FA4 的视觉与操作体验。',
    minimum_chrome_version: '120',
    permissions: ['storage', 'activeTab', 'scripting', 'declarativeNetRequest'],
    declarative_net_request: {
      rule_resources: [{ id: 'gravatar', enabled: true, path: 'gravatar-rules.json' }],
    },
    host_permissions: [
      '*://oj.7fa4.cn/*',
      '*://jx.7fa4.cn/*',
      '*://in.7fa4.cn/*',
      '*://10.210.57.10/*',
      '*://211.137.101.118/*',
    ],
    icons,
    action: { default_title: 'Asterveil', default_icon: icons },
  },
});
