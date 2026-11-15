import type { z } from 'zod';
import type { onMessage } from '../messaging';

declare module 'zod' {
  interface GlobalMeta {
    /** 选项字段在设置页上显示的文字，键为选项值。 */
    optionLabels?: Record<string, string>;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 模型调用。实现在 `core/llm`，功能模块只通过 `BackgroundContext` 拿到它。 */
export interface Provider {
  complete(messages: readonly ChatMessage[], signal: AbortSignal): Promise<string>;
}

export interface BackgroundContext {
  onMessage: typeof onMessage;
  /** 用当前保存的设置和 API key 创建模型调用。未配置时抛出 `notConfigured` 类错误。 */
  getProvider(): Promise<{ provider: Provider; model: string }>;
}

/**
 * 设置页能渲染的字段：带默认值的文本，或带默认值的选项。
 * 用 `.meta({ title })` 给出字段名，选项字段再用 `optionLabels` 给出各选项的文字。
 */
export type FeatureSettingField =
  | z.ZodDefault<z.ZodString>
  | z.ZodDefault<z.ZodEnum<Record<string, string>>>;

export type FeatureSettingsSchema = z.ZodObject<Record<string, FeatureSettingField>>;

export interface Feature<S extends FeatureSettingsSchema = FeatureSettingsSchema> {
  id: string;
  /** 设置页上该功能区块的标题。 */
  name: string;
  /** 该功能的设置结构与默认值。 */
  settings: S;
  /** 注册后台消息处理。 */
  background?(ctx: BackgroundContext): void;
}

export function defineFeature<S extends FeatureSettingsSchema>(feature: Feature<S>): Feature<S> {
  return feature;
}
