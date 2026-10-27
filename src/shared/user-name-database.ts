import database from '../data/user-names.encrypted.json';
import { decryptUserNames } from './user-name-encryption';
import type { UserGrade } from './user-name-palette';
import type { UserNameEntry } from './user-name-sources';

export interface OfficialUserNameDatabase {
  readonly names: ReadonlyMap<string, string>;
  readonly grades: ReadonlyMap<string, UserGrade>;
}

export function userNameEntryDatabase(entries: readonly UserNameEntry[]): OfficialUserNameDatabase {
  return {
    names: new Map(entries.map(([id, name]) => [id, name])),
    grades: new Map(entries.map(([id, , grade]) => [id, grade ?? 'uk'])),
  };
}

export const decryptOfficialUserNames = (password: string) => decryptUserNames(database, password);
export const officialUserNameDatabaseRevision = `${database.academicYear}:${database.iv}`;
