import { copyFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
for (const name of ['index.html', 'style.css', 'main.js', 'icon.svg']) {
  await copyFile(new URL(name, root), new URL(`dist/${name}`, root));
}
console.log('Built Asterveil website → dist/');
