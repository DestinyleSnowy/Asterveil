import { parseUserNameSource, type UserNameEntry } from './user-name-sources';

export interface EncryptedUserNames {
  readonly version: number;
  readonly algorithm: string;
  readonly kdf: string;
  readonly iterations: number;
  readonly academicYear: number;
  readonly records: number;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

export function userNameEncryptionContext(data: EncryptedUserNames): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      data.version,
      data.algorithm,
      data.kdf,
      data.iterations,
      data.academicYear,
      data.records,
    ]),
  );
}

export async function decryptUserNames(
  data: EncryptedUserNames,
  password: string,
): Promise<readonly UserNameEntry[]> {
  if (
    data.version !== 1 ||
    data.algorithm !== 'AES-GCM' ||
    data.kdf !== 'PBKDF2-SHA256' ||
    data.iterations !== 600_000 ||
    !Number.isSafeInteger(data.records) ||
    data.records <= 0 ||
    data.records > 10_000 ||
    !password.trim()
  )
    throw new Error('官方数据无法解锁');
  const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  try {
    const salt = decode(data.salt);
    const iv = decode(data.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error();
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password.trim().normalize('NFC')),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: data.iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: userNameEncryptionContext(data), tagLength: 128 },
      key,
      decode(data.ciphertext),
    );
    const entries = parseUserNameSource(
      new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
    );
    if (entries.length !== data.records) throw new Error();
    return entries;
  } catch {
    // Never include the signature, decrypted payload or cryptographic errors in UI/logs.
    throw new Error('官方数据无法解锁');
  }
}
