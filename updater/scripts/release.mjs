import assert from 'node:assert/strict';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicPath = resolve(root, 'updater/release-public-key.hex');
const [command, argument] = process.argv.slice(2);

if (command === 'keygen') {
  assert.ok(argument, 'Specify a private key file OUTSIDE the repository.');
  const path = resolve(argument);
  assert.ok(
    !path.toLowerCase().startsWith(`${root.toLowerCase()}\\`) && !path.startsWith(`${root}/`),
    'Keep private keys outside the repository.',
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    flag: 'wx',
    mode: 0o600,
  });
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  writeFileSync(publicPath, `${raw.toString('hex')}\n`);
  console.log('Signing key created; public key saved to updater/release-public-key.hex.');
} else if (command === 'sign') {
  const output = resolve(argument ?? resolve(root, '.output'));
  const pem =
    process.env.ASTERVEIL_UPDATE_PRIVATE_KEY ??
    readFileSync(process.env.ASTERVEIL_UPDATE_PRIVATE_KEY_FILE ?? '', 'utf8');
  const key = createPrivateKey(pem);
  const pub = createPublicKey(key);
  assert.equal(
    Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex'),
    readFileSync(publicPath, 'utf8').trim(),
    'Signing key does not match the pinned updater key.',
  );
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const packages = [
    ['light', 'Asterveil'],
    ['full', 'Asterveil-Pro'],
  ].map(([edition, prefix]) => {
    const name = `${prefix}-${version}-chrome.zip`;
    const bytes = readFileSync(resolve(output, name));
    return {
      edition,
      name,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const bytes = Buffer.from(
    `${JSON.stringify({ schema: 1, repository: 'DestinyleSnowy/Asterveil', version, min_updater: '0.1.0', packages })}\n`,
  );
  const signature = sign(null, bytes, key);
  assert.ok(verify(null, bytes, pub, signature));
  writeFileSync(resolve(output, 'update-manifest.json'), bytes);
  writeFileSync(resolve(output, 'update-manifest.sig'), signature);
  console.log(`Signed Asterveil ${version} update manifest.`);
} else {
  throw new Error(
    'Usage: node updater/scripts/release.mjs keygen <private-key-path> | sign [packages-directory]',
  );
}
