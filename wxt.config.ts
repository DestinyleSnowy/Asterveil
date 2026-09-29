/// <reference types="node" />
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { katexAssets } from './build/katex-assets';
import { lightEdition } from './build/light-edition';
import { contentMatches } from './src/site/target';

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
  vite: ({ mode }) => ({
    define: { __ASTERVEIL_PDF__: JSON.stringify(mode !== 'light') },
    plugins: [katexAssets(), ...(mode === 'light' ? [lightEdition()] : [])],
    build: {
      rolldownOptions: {
        output: {
          // Chromium rejects literal Unicode noncharacters (KaTeX includes U+FFFF).
          // Let the code generator escape literals without changing their values.
          minify: { codegen: { asciiOnly: true } },
        },
      },
    },
  }),
  hooks: {
    async 'build:done'(wxt) {
      const manifest = JSON.parse(
        await readFile(resolve(wxt.config.outDir, 'manifest.json'), 'utf8'),
      );
      for (const script of manifest.content_scripts ?? []) {
        for (const file of [...(script.js ?? []), ...(script.css ?? [])]) {
          const bytes = await readFile(resolve(wxt.config.outDir, file));
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          for (const character of source) {
            const point = character.codePointAt(0) as number;
            if ((point >= 0xfdd0 && point <= 0xfdef) || (point & 0xffff) >= 0xfffe) {
              throw new Error(
                `Chrome cannot load ${file}: literal U+${point.toString(16).toUpperCase()}`,
              );
            }
          }
        }
      }
    },
    async 'build:publicAssets'(wxt, files) {
      const full = wxt.config.mode !== 'light';
      for (const dependency of [
        'marked',
        'dompurify',
        'katex',
        'html-to-image',
        ...(full
          ? ['pdf-lib', 'pdfjs-dist', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib']
          : []),
      ]) {
        const source = resolve('node_modules', dependency);
        for (const name of await readdir(source)) {
          if (/^(license|notice|copyright)(\.|$)/i.test(name)) {
            files.push({
              absoluteSrc: resolve(source, name),
              relativeDest: `licenses/${dependency}/${name}`,
            });
          }
        }
      }
      for (const directory of full ? ['cmaps', 'standard_fonts', 'wasm', 'iccs'] : []) {
        const source = resolve('node_modules/pdfjs-dist', directory);
        for (const name of await readdir(source)) {
          files.push({
            absoluteSrc: resolve(source, name),
            relativeDest: `pdfjs/${directory}/${name}`,
          });
        }
      }
    },
  },
  manifest: ({ mode }) => ({
    name: mode === 'light' ? 'Asterveil Light' : 'Asterveil Full',
    description: '以独立模块改善 7FA4 的视觉与操作体验。',
    minimum_chrome_version: '120',
    permissions: ['storage', 'activeTab', 'scripting', 'declarativeNetRequest'],
    ...(mode !== 'light' && {
      web_accessible_resources: [{ resources: ['pdfjs/*'], matches: contentMatches }],
    }),
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
  }),
});
