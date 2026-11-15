// 只允许后台入口引用（scripts/ci/check-deps.mjs 强制）。扩展页面通过消息写入 key，只能拿回 ApiKeyStatus。
import { type ApiKeyStatus, KindedError } from '../messaging';
import type { KeyValueStore } from '../settings';

/** 与设置分开存放，读取设置时不会顺带读出 key。 */
export const API_KEY_STORAGE_KEY = 'secrets.apiKey';

/** 短于这个长度的 key 不显示任何字符。 */
const MIN_LENGTH_TO_REVEAL = 16;
const VISIBLE_SUFFIX = 4;

/**
 * 生成掩码：可识别的短前缀（如 `sk-`）加「…」加末尾 4 个字符。
 * 连续可见的字符最多 4 个，中间部分永远不显示；短 key 只显示「…」。
 */
export function maskApiKey(key: string): string {
  if (key.length < MIN_LENGTH_TO_REVEAL) return '…';
  const prefix = /^[a-z]{2,3}-/i.exec(key)?.[0] ?? '';
  return `${prefix}…${key.slice(-VISIBLE_SUFFIX)}`;
}

export async function readApiKey(store: KeyValueStore): Promise<string | null> {
  const value = (await store.get(API_KEY_STORAGE_KEY))[API_KEY_STORAGE_KEY];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function getApiKeyStatus(store: KeyValueStore): Promise<ApiKeyStatus> {
  const key = await readApiKey(store);
  return key === null ? { isSet: false, mask: null } : { isSet: true, mask: maskApiKey(key) };
}

export async function writeApiKey(store: KeyValueStore, apiKey: unknown): Promise<ApiKeyStatus> {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new KindedError('invalidInput', 'API key 不能为空');
  }
  const key = apiKey.trim();
  await store.set({ [API_KEY_STORAGE_KEY]: key });
  return { isSet: true, mask: maskApiKey(key) };
}
