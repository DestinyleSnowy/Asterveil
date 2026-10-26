import assert from 'node:assert/strict';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptUserNames } from '../../build/encrypt-user-names.mjs';

const encrypted = JSON.parse(
  await readFile(new URL('../../src/data/user-names.encrypted.json', import.meta.url), 'utf8'),
);
export const fixturePassword = 'public-browser-fixture-only';
export const fixtureNames = Object.fromEntries(
  Array.from({ length: encrypted.records }, (_, index) => [
    String(index + 1),
    `测试用户${index + 1}`,
  ]),
);
export const fixtureGrades = Object.fromEntries(Object.keys(fixtureNames).map((id) => [id, 'uk']));
fixtureGrades['1'] = 'jl';
fixtureGrades['5'] = 'g1';
fixtureGrades['6'] = 'g2';
fixtureGrades['2476'] = 'c1';

export async function testUserNameExtension(source, destination) {
  // Exercise the actual unpacked extension with synthetic names and a public test password.
  // The production ciphertext and password are never decrypted or needed by this test.
  const fixture = await encryptUserNames(fixtureNames, fixtureGrades, 2026, fixturePassword);
  await cp(source, destination, { recursive: true });
  let replacements = 0;
  async function patch(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await patch(path);
      else if (entry.name.endsWith('.js')) {
        let text = await readFile(path, 'utf8');
        if (!text.includes(encrypted.ciphertext)) continue;
        for (const key of ['salt', 'iv', 'ciphertext']) {
          assert.ok(text.includes(encrypted[key]), `Missing encrypted ${key}`);
          text = text.replaceAll(encrypted[key], fixture[key]);
        }
        await writeFile(path, text);
        replacements++;
      }
    }
  }
  await patch(destination);
  assert.ok(replacements >= 2, 'Both content and background must use the encrypted fixture');
  return destination;
}
