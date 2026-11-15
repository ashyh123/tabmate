import { z } from 'zod';
import { defineFeature } from '../../core/feature';

/** 翻译功能的占位：只注册设置结构，翻译逻辑属于 TM-003。 */
export const translateFeature = defineFeature({
  id: 'translate',
  name: '翻译',
  settings: z.object({
    targetLanguage: z
      .string()
      .trim()
      .min(1, { error: '请填写目标语言' })
      .default('zh-CN')
      .meta({ title: '目标语言', description: '语言代码，如 zh-CN、en、ja' }),
    displayMode: z
      .enum(['bilingual', 'replace'], { error: '请选择显示模式' })
      .default('bilingual')
      .meta({
        title: '默认显示模式',
        optionLabels: { bilingual: '对照（原文加译文）', replace: '替换（只显示译文）' },
      }),
  }),
});
