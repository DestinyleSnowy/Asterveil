import { browser } from 'wxt/browser';
import type { SettingsCommand, SettingsRequest } from '../shared/protocol';
import { decodeSettings, isRecord, type Settings } from '../shared/settings';

export async function requestSettings(command: SettingsCommand): Promise<Settings> {
  const request: SettingsRequest = { channel: 'asterveil', ...command };
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isRecord(response) || typeof response.ok !== 'boolean') {
    throw new Error('后台未响应，请在扩展管理页重新加载 Asterveil。');
  }
  if (!response.ok) {
    throw new Error(typeof response.error === 'string' ? response.error : '无法保存设置。');
  }
  return decodeSettings(response.settings);
}
