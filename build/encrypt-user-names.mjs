import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function encryptUserNames(names, grades, academicYear, password) {
  if (typeof password !== 'string' || !password.trim()) throw new Error('需要数据库口令');
  const ids = Object.keys(names);
  if (!ids.length || ids.length !== Object.keys(grades).length)
    throw new Error('姓名与年级记录不一致');
  const users = Object.fromEntries(
    ids.map((id) => {
      if (
        !/^[1-9]\d*$/.test(id) ||
        !Number.isSafeInteger(Number(id)) ||
        typeof names[id] !== 'string' ||
        !names[id].trim() ||
        names[id].length > 128 ||
        [...names[id]].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        !/^(?:x[456]|c[123]|g[123]|d[1234]|by|jl|uk|clear)$/.test(grades[id])
      )
        throw new Error('姓名或年级记录无效');
      return [id, { name: names[id].trim().normalize('NFC'), colorKey: grades[id] }];
    }),
  );
  const data = {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 600_000,
    academicYear,
    records: ids.length,
  };
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const material = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.trim().normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: data.iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await webcrypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(JSON.stringify(Object.values(data))),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(JSON.stringify({ academicYear, users })),
  );
  return {
    ...data,
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  };
}

if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Pipe the password through stdin; it is never accepted as a command-line argument.
  let password = '';
  for await (const chunk of process.stdin) password += chunk;
  const directory = new URL('../src/data/', import.meta.url);
  const names = JSON.parse(await readFile(new URL('user-names.json', directory), 'utf8'));
  const grades = JSON.parse(await readFile(new URL('user-grades.json', directory), 'utf8'));
  const source = JSON.parse(await readFile(new URL('user-names.source.json', directory), 'utf8'));
  const encrypted = await encryptUserNames(names, grades, source.academicYear, password);
  password = '';
  await writeFile(
    new URL('user-names.encrypted.json', directory),
    `${JSON.stringify(encrypted, null, 2)}\n`,
  );
  console.log(`Encrypted ${encrypted.records} official records.`);
}
