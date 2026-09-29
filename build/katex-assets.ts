import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep the official math font metrics in previews and exported SVG/canvas images.
export function katexAssets() {
  const id = 'virtual:homework-katex';
  return {
    name: 'homework-katex-fonts',
    resolveId(source: string) {
      if (source === id) return `\0${id}`;
    },
    async load(source: string) {
      if (source !== `\0${id}`) return;
      const css = await readFile(resolve('node_modules/katex/dist/katex.min.css'), 'utf8');
      const faces = css.match(/@font-face\s*\{[^}]+\}/g) ?? [];
      const embedded = await Promise.all(
        faces.map(async (face) => {
          const name = /url\(fonts\/([^)]*\.woff2)\)/.exec(face)?.[1];
          if (!name) throw new Error('KaTeX font has no WOFF2 source');
          const data = await readFile(resolve('node_modules/katex/dist/fonts', name));
          return face.replace(
            /src:[^;}]+;?/,
            `src: url(data:font/woff2;base64,${data.toString('base64')}) format("woff2");`,
          );
        }),
      );
      return `export const fontCss = ${JSON.stringify(embedded.join('\n'))}; export const layoutCss = ${JSON.stringify(css.replace(/@font-face\s*\{[^}]+\}/g, ''))};`;
    },
  };
}
