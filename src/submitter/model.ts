import { isRecord } from '../shared/settings';

export const SUBMITTER_VERSION = '0.1.13';
export const SUBMITTER_ORIGIN_KEY = 'asterveil:submitter-origin';

const targetHosts = new Set([
  'oj.7fa4.cn',
  'jx.7fa4.cn:8888',
  'jx.7fa4.cn:5283',
  'in.7fa4.cn:8888',
  'in.7fa4.cn:5283',
  '10.210.57.10:8888',
  '10.210.57.10:5283',
  '211.137.101.118:8888',
  '211.137.101.118:5283',
]);

export function targetOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      targetHosts.has(url.host)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export const ojNames = [
  'luogu',
  'uoj',
  'qoj',
  'cf',
  'cfgym',
  'atc',
  'at',
  'vj',
  'gym',
  'cc',
  'csa',
  'zr',
  'xyd',
  'oifha',
  'mx',
  '7fa4',
] as const;
export type Oj = (typeof ojNames)[number];
export interface Submission {
  code: string;
  pid: string;
  rid: string;
  oj: Oj;
  language: 'cpp17';
  status: string;
  total_time: number;
  max_memory: number;
  score: number;
  in_contest: false;
}

export type SubmitterRequest =
  | { channel: 'asterveil:submitter'; type: 'status' }
  | { channel: 'asterveil:submitter'; type: 'login'; origin: string }
  | { channel: 'asterveil:submitter'; type: 'submit'; submission: Submission };
export type SubmitterResponse =
  | { ok: true; message: string; origin?: string; nickname?: string }
  | { ok: false; error: string };

export function isSubmission(value: unknown): value is Submission {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    value.code.trim().length > 0 &&
    value.code.length <= 2_000_000 &&
    typeof value.pid === 'string' &&
    value.pid.trim().length > 0 &&
    value.pid.length <= 200 &&
    typeof value.rid === 'string' &&
    value.rid.length > 0 &&
    value.rid.length <= 200 &&
    ojNames.some((oj) => oj === value.oj) &&
    value.language === 'cpp17' &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    value.status.length <= 100 &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    typeof value.total_time === 'number' &&
    Number.isFinite(value.total_time) &&
    value.total_time >= 0 &&
    typeof value.max_memory === 'number' &&
    Number.isFinite(value.max_memory) &&
    value.max_memory >= 0 &&
    value.in_contest === false
  );
}

export function isSubmitterRequest(value: unknown): value is SubmitterRequest {
  if (!isRecord(value) || value.channel !== 'asterveil:submitter') return false;
  return (
    value.type === 'status' ||
    (value.type === 'login' &&
      typeof value.origin === 'string' &&
      targetOrigin(value.origin) === value.origin) ||
    (value.type === 'submit' && isSubmission(value.submission))
  );
}
