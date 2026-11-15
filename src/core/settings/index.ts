import { z } from 'zod';
import type { FeatureSettingsSchema } from '../feature';

/** `chrome.storage.local` 中本模块用到的部分。单元测试用内存实现代替。 */
export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const SETTINGS_STORAGE_KEY = 'settings';

const apiBaseUrl = z
  .url({ protocol: /^https?$/, error: '请填写以 http:// 或 https:// 开头的地址' })
  .default(DEFAULT_API_BASE_URL);
const model = z.string().trim().min(1, { error: '请填写模型名' });

/** 保存时的核心设置：模型名必填，没有默认值。 */
const coreSettingsInputSchema = z.object({ apiBaseUrl, model });
/** 读取时的核心设置：首次保存之前模型名可以不存在。 */
const coreSettingsSchema = z.object({ apiBaseUrl, model: model.optional() });

export type CoreSettings = z.output<typeof coreSettingsSchema>;

export interface Settings {
  core: CoreSettings;
  /** 按功能 id 分组的各功能设置。 */
  features: Record<string, Record<string, string>>;
}

/** 只需要功能的 id 和设置结构，避免本模块依赖具体功能。 */
interface FeatureSettingsSource {
  id: string;
  settings: FeatureSettingsSchema;
}

export class SettingsValidationError extends Error {
  readonly kind = 'invalidSettings';
  /** 键为字段路径，如 `core.model`、`features.translate.displayMode`。 */
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors).join('；'));
    this.name = 'SettingsValidationError';
    this.fieldErrors = fieldErrors;
  }
}

function section(raw: unknown, key: string): unknown {
  if (typeof raw !== 'object' || raw === null) return undefined;
  return (raw as Record<string, unknown>)[key];
}

function parseOrDefault<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/** 读取设置。缺失的字段补默认值；某一部分存储内容损坏时，该部分回退到默认值，不抛错。 */
export async function loadSettings(
  store: KeyValueStore,
  features: readonly FeatureSettingsSource[],
): Promise<Settings> {
  const raw = (await store.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY];
  const rawFeatures = section(raw, 'features');
  return {
    core: parseOrDefault(coreSettingsSchema, section(raw, 'core')),
    features: Object.fromEntries(
      features.map((feature) => [
        feature.id,
        parseOrDefault(feature.settings, section(rawFeatures, feature.id)),
      ]),
    ),
  };
}

/** 校验并保存设置。任何字段不合法时抛出 `SettingsValidationError`，不写入存储。 */
export async function saveSettings(
  store: KeyValueStore,
  features: readonly FeatureSettingsSource[],
  input: { core: unknown; features: Record<string, unknown> },
): Promise<Settings> {
  const fieldErrors: Record<string, string> = {};
  const collect = (prefix: string, error: z.ZodError) => {
    for (const issue of error.issues) {
      const path = [prefix, ...issue.path.map(String)].join('.');
      fieldErrors[path] ??= issue.message;
    }
  };

  const core = coreSettingsInputSchema.safeParse(input.core);
  if (!core.success) collect('core', core.error);

  const featureSettings: Record<string, Record<string, string>> = {};
  for (const feature of features) {
    const parsed = feature.settings.safeParse(input.features[feature.id] ?? {});
    if (parsed.success) featureSettings[feature.id] = parsed.data;
    else collect(`features.${feature.id}`, parsed.error);
  }

  if (!core.success || Object.keys(fieldErrors).length > 0) {
    throw new SettingsValidationError(fieldErrors);
  }
  const settings: Settings = { core: core.data, features: featureSettings };
  await store.set({ [SETTINGS_STORAGE_KEY]: settings });
  return settings;
}
