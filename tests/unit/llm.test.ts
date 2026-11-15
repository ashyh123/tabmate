import { describe, expect, it } from 'vitest';
import { createOpenAiCompatibleProvider, LLM_ERROR_MESSAGES, LlmError } from '../../src/core/llm';

const API_KEY = 'sk-test-unit-0000000000000000';

function providerWith(fetch: typeof globalThis.fetch) {
  return createOpenAiCompatibleProvider({
    baseUrl: 'https://llm.example.test/v1/',
    apiKey: API_KEY,
    model: 'test-model',
    fetch,
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function errorFrom(fetch: typeof globalThis.fetch): Promise<LlmError> {
  const error = await providerWith(fetch)
    .complete([{ role: 'user', content: 'hi' }], new AbortController().signal)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LlmError);
  return error as LlmError;
}

describe('OpenAI 兼容的 Chat Completions', () => {
  it('成功时返回第一条回复的文本，并按约定发出请求', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = providerWith(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json(200, { choices: [{ message: { role: 'assistant', content: '你好' } }] });
    });
    const messages = [{ role: 'user' as const, content: 'hi' }];

    await expect(provider.complete(messages, new AbortController().signal)).resolves.toBe('你好');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(call?.init.method).toBe('POST');
    expect(new Headers(call?.init.headers).get('Authorization')).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(call?.init.body))).toEqual({ model: 'test-model', messages });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rateLimit'],
    [404, 'endpoint'],
    [400, 'endpoint'],
    [500, 'network'],
    [503, 'network'],
  ] as const)('HTTP %i 归为 %s', async (status, kind) => {
    const error = await errorFrom(async () => json(status, { error: { message: 'x' } }));
    expect(error.kind).toBe(kind);
    expect(error.message).toContain(LLM_ERROR_MESSAGES[kind]);
  });

  it('fetch 失败（网络不通）归为 network', async () => {
    const error = await errorFrom(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(error.kind).toBe('network');
  });

  it('超时归为 network', async () => {
    const provider = providerWith(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const error = await provider
      .complete([{ role: 'user', content: 'hi' }], AbortSignal.timeout(10))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('network');
  });

  it('调用方主动取消时原样抛出取消原因', async () => {
    const controller = new AbortController();
    const reason = new Error('用户取消');
    const provider = providerWith(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const pending = provider.complete([{ role: 'user', content: 'hi' }], controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it.each([
    ['不是 JSON', () => new Response('<html>not found</html>', { status: 200 })],
    ['没有 choices', () => json(200, { result: 'ok' })],
    ['choices 为空', () => json(200, { choices: [] })],
    ['content 不是字符串', () => json(200, { choices: [{ message: { content: null } }] })],
  ])('响应格式不符（%s）归为 badResponse', async (_name, respond) => {
    const error = await errorFrom(async () => respond());
    expect(error.kind).toBe('badResponse');
  });

  it('错误信息中不包含 API key', async () => {
    const error = await errorFrom(async () =>
      json(401, { error: { message: `bad key ${API_KEY}` } }),
    );
    expect(error.message).not.toContain(API_KEY);
  });
});
