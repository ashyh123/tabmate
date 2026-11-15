import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  loadSettings,
  SETTINGS_STORAGE_KEY,
  SettingsValidationError,
  saveSettings,
} from '../../src/core/settings';
import { features } from '../../src/features';
import { memoryStore } from './memory-store';

const defaults = {
  core: { apiBaseUrl: DEFAULT_API_BASE_URL },
  features: { translate: { targetLanguage: 'zh-CN', displayMode: 'bilingual' } },
};

const validInput = {
  core: { apiBaseUrl: 'https://example.test/v1', model: 'test-model' },
  features: { translate: { targetLanguage: 'ja', displayMode: 'replace' } },
};

describe('读取设置', () => {
  it('空存储得到默认值，模型名没有默认值', async () => {
    const { store } = memoryStore();
    const settings = await loadSettings(store, features);
    expect(settings).toEqual(defaults);
    expect(settings.core.model).toBeUndefined();
  });

  it.each([
    ['不是对象', 'garbage'],
    ['null', null],
    ['字段类型错误', { core: { apiBaseUrl: 42, model: [] }, features: { translate: 7 } }],
    [
      '字段值非法',
      { core: { apiBaseUrl: 'ftp://x' }, features: { translate: { displayMode: 'x' } } },
    ],
  ])('存储内容损坏（%s）时回退到默认值，不抛错', async (_name, raw) => {
    const { store } = memoryStore({ [SETTINGS_STORAGE_KEY]: raw });
    await expect(loadSettings(store, features)).resolves.toEqual(defaults);
  });

  it('只回退损坏的部分，其他部分保留', async () => {
    const { store } = memoryStore({
      [SETTINGS_STORAGE_KEY]: {
        core: { apiBaseUrl: 'https://example.test/v1', model: 'm' },
        features: { translate: { displayMode: 'nonsense' } },
      },
    });
    const settings = await loadSettings(store, features);
    expect(settings.core).toEqual({ apiBaseUrl: 'https://example.test/v1', model: 'm' });
    expect(settings.features.translate).toEqual(defaults.features.translate);
  });

  it('缺失的字段补默认值', async () => {
    const { store } = memoryStore({
      [SETTINGS_STORAGE_KEY]: {
        core: { model: 'm' },
        features: { translate: { targetLanguage: 'en' } },
      },
    });
    const settings = await loadSettings(store, features);
    expect(settings.core).toEqual({ apiBaseUrl: DEFAULT_API_BASE_URL, model: 'm' });
    expect(settings.features.translate).toEqual({ targetLanguage: 'en', displayMode: 'bilingual' });
  });
});

describe('保存设置', () => {
  it('合法的设置保存后能原样读回', async () => {
    const { store } = memoryStore();
    await saveSettings(store, features, validInput);
    await expect(loadSettings(store, features)).resolves.toEqual(validInput);
  });

  it.each([
    ['core.apiBaseUrl', { ...validInput, core: { ...validInput.core, apiBaseUrl: 'not a url' } }],
    ['core.apiBaseUrl', { ...validInput, core: { ...validInput.core, apiBaseUrl: 'file:///etc' } }],
    ['core.model', { ...validInput, core: { ...validInput.core, model: '   ' } }],
    ['core.model', { ...validInput, core: { apiBaseUrl: 'https://example.test/v1' } }],
    [
      'features.translate.displayMode',
      {
        ...validInput,
        features: { translate: { targetLanguage: 'ja', displayMode: 'side-by-side' } },
      },
    ],
    [
      'features.translate.targetLanguage',
      { ...validInput, features: { translate: { targetLanguage: '', displayMode: 'replace' } } },
    ],
  ])('非法字段 %s 被拒绝，存储不变', async (field, input) => {
    const { store, data } = memoryStore();
    const error = await saveSettings(store, features, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettingsValidationError);
    expect(Object.keys((error as SettingsValidationError).fieldErrors)).toEqual([field]);
    expect(data.has(SETTINGS_STORAGE_KEY)).toBe(false);
  });
});
