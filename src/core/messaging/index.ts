import { browser } from 'wxt/browser';

/** 设置页能看到的 API key 状态。永远不包含完整的 key。 */
export interface ApiKeyStatus {
  isSet: boolean;
  /** 已设置时为掩码（如 `sk-…abcd`），未设置时为 null。 */
  mask: string | null;
}

/**
 * 协议表：消息名 → 请求类型、响应类型。
 * 功能模块要加自己的消息时，用声明合并（`declare module`）向这个接口加条目，内核不需要引用功能。
 */
export interface Protocol {
  'secrets.setApiKey': { req: { apiKey: string }; res: ApiKeyStatus };
  'secrets.getApiKeyStatus': { req: Record<string, never>; res: ApiKeyStatus };
  'llm.testConnection': { req: Record<string, never>; res: { model: string } };
}

export type MessageName = keyof Protocol;
export type Req<N extends MessageName> = Protocol[N]['req'];
export type Res<N extends MessageName> = Protocol[N]['res'];

/** 错误类别。处理函数抛出带字符串 `kind` 的错误时原样保留，否则为 `internal`。 */
export interface MessageError {
  kind: string;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: MessageError };

/** 带 `kind` 的错误。处理函数抛出它，发送方会在 `Result.error.kind` 中拿到同一个类别。 */
export class KindedError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = 'KindedError';
    this.kind = kind;
  }
}

interface Envelope {
  name: string;
  req: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    'req' in value
  );
}

/** 把任意抛出值转成可以跨环境传递的结构化错误。 */
export function toMessageError(error: unknown): MessageError {
  if (error instanceof Error) {
    const kind = (error as { kind?: unknown }).kind;
    return { kind: typeof kind === 'string' ? kind : 'internal', message: error.message };
  }
  return { kind: 'internal', message: String(error) };
}

export async function sendMessage<N extends MessageName>(
  name: N,
  req: Req<N>,
): Promise<Result<Res<N>>> {
  try {
    const response: unknown = await browser.runtime.sendMessage({ name, req } satisfies Envelope);
    if (typeof response !== 'object' || response === null || !('ok' in response)) {
      return { ok: false, error: { kind: 'internal', message: `消息 ${name} 没有处理者` } };
    }
    return response as Result<Res<N>>;
  } catch (error) {
    return { ok: false, error: toMessageError(error) };
  }
}

/**
 * 注册某个消息的处理函数。只接受来自本扩展的消息。
 * 处理函数抛出的错误以 `{ ok: false, error: { kind, message } }` 返回给发送方。
 */
export function onMessage<N extends MessageName>(
  name: N,
  handler: (req: Req<N>) => Promise<Res<N>> | Res<N>,
): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isEnvelope(message) || message.name !== name) return false;
    if (sender.id !== browser.runtime.id) return false;
    Promise.resolve()
      .then(() => handler(message.req as Req<N>))
      .then(
        (data) => sendResponse({ ok: true, data } satisfies Result<Res<N>>),
        (error: unknown) =>
          sendResponse({ ok: false, error: toMessageError(error) } satisfies Result<Res<N>>),
      );
    return true;
  });
}
