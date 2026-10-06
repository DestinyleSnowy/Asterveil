import { isRecord } from './settings';

export const updateChannel = 'asterveil:updater';
export const updateStorageKey = 'asterveil:updater';
export const updateHost = 'cn.asterveil.updater';
export type UpdateState = {
  enabled: boolean;
  status: 'idle' | 'checking' | 'waiting' | 'installing' | 'current' | 'error' | 'unavailable';
  message: string;
  version: string;
  checkedAt: number;
};
export const initialUpdateState: UpdateState = {
  enabled: false,
  status: 'idle',
  message: '',
  version: '',
  checkedAt: 0,
};
export type UpdateRequest =
  | { channel: typeof updateChannel; type: 'read' | 'check' }
  | { channel: typeof updateChannel; type: 'enabled'; enabled: boolean };

export function isUpdateRequest(value: unknown): value is UpdateRequest {
  return (
    isRecord(value) &&
    value.channel === updateChannel &&
    (value.type === 'read' ||
      value.type === 'check' ||
      (value.type === 'enabled' && typeof value.enabled === 'boolean'))
  );
}

export function readUpdateState(value: unknown): UpdateState {
  if (!isRecord(value)) return { ...initialUpdateState };
  return {
    enabled: value.enabled === true,
    status: [
      'idle',
      'checking',
      'waiting',
      'installing',
      'current',
      'error',
      'unavailable',
    ].includes(String(value.status))
      ? (value.status as UpdateState['status'])
      : 'idle',
    message: typeof value.message === 'string' ? value.message.slice(0, 240) : '',
    version: typeof value.version === 'string' ? value.version : '',
    checkedAt: typeof value.checkedAt === 'number' ? value.checkedAt : 0,
  };
}
