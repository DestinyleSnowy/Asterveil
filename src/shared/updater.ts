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

export function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'current':
      return '当前已是最新版本';
    case 'checking':
      return '正在检查更新…';
    case 'installing':
      return '正在安装更新…';
    case 'waiting':
      return '操作完成后更新';
    case 'unavailable':
      return '请先安装更新器';
    case 'error':
      if (/受限|429/.test(state.message)) return '检查频繁，请稍后再试';
      if (/网络|连接|超时/.test(state.message)) return '连接失败，请稍后重试';
      if (/签名|校验|清单|附件|发布|下载/.test(state.message)) return '暂时无法获取更新';
      return '更新失败，请重试';
    default:
      return '';
  }
}
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
