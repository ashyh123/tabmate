// 只允许后台入口引用（scripts/ci/check-deps.mjs 强制）。功能模块通过 BackgroundContext.getProvider 拿到模型调用。
import { z } from 'zod';
import type { ChatMessage, Provider } from '../feature';

export type LlmErrorKind = 'auth' | 'rateLimit' | 'network' | 'endpoint' | 'badResponse';

export const LLM_ERROR_MESSAGES: Record<LlmErrorKind, string> = {
  auth: 'API key 无效或没有权限',
  rateLimit: '请求过于频繁或额度不足，已被限流',
  network: '网络不通或服务暂时不可用',
  endpoint: 'API 地址或模型名错误',
  badResponse: '模型接口返回的内容格式不符合预期',
};

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, detail?: string) {
    super(detail ? `${LLM_ERROR_MESSAGES[kind]}（${detail}）` : LLM_ERROR_MESSAGES[kind]);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

function kindForStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rateLimit';
  if (status >= 500) return 'network';
  return 'endpoint';
}

const choiceSchema = z.object({ message: z.object({ content: z.string() }) });
const chatCompletionSchema = z.object({
  // 至少一项：[第一项, ...其余]
  choices: z.tuple([choiceSchema], choiceSchema),
});

export interface OpenAiCompatibleOptions {
  /** 如 `https://api.openai.com/v1`，末尾的 `/` 可有可无。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

/** OpenAI 兼容的 Chat Completions。错误统一抛出 LlmError；调用方主动取消时原样抛出取消原因。 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): Provider {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async complete(messages: readonly ChatMessage[], signal: AbortSignal): Promise<string> {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({ model: options.model, messages }),
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          if ((signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError') {
            throw new LlmError('network', '请求超时');
          }
          throw signal.reason;
        }
        throw new LlmError('network', error instanceof Error ? error.message : undefined);
      }

      if (!response.ok) {
        throw new LlmError(kindForStatus(response.status), `HTTP ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LlmError('badResponse', '不是 JSON');
      }
      const parsed = chatCompletionSchema.safeParse(body);
      if (!parsed.success) throw new LlmError('badResponse');
      return parsed.data.choices[0].message.content;
    },
  };
}
