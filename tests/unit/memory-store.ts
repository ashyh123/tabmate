import type { KeyValueStore } from '../../src/core/settings';

/** 内存中的 KeyValueStore，行为与 chrome.storage.local 的 get(key) / set(items) 一致。 */
export function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const store: KeyValueStore = {
    async get(key) {
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
  };
  return { store, data };
}
