import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      resolve(root, 'updater/Cargo.toml'),
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  ),
);
const output = [];
for (const pkg of metadata.packages
  .filter((p) => p.name !== 'asterveil-updater')
  .sort((a, b) => a.name.localeCompare(b.name))) {
  output.push(
    `${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? 'See license file'}\nSource: ${pkg.repository ?? pkg.source}`,
  );
  const directory = dirname(pkg.manifest_path);
  const files = readdirSync(directory).filter((name) =>
    /^(LICENSE|COPYING|NOTICE)([-.]|$)/i.test(name),
  );
  if (pkg.license_file && !files.includes(pkg.license_file)) files.push(pkg.license_file);
  for (const name of files)
    output.push(`${name}\n${readFileSync(resolve(directory, name), 'utf8')}`);
}
writeFileSync(process.argv[2], output.join('\n\n----------------------------------------\n\n'));
