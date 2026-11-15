import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

/** 本地假的 Chat Completions 服务。`respondWith` 决定下一次请求的状态码。 */
export async function startFakeLlmServer() {
  const requests: RecordedRequest[] = [];
  let status = 200;

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = status;
      res.end(
        JSON.stringify(
          status === 200
            ? { choices: [{ index: 0, message: { role: 'assistant', content: 'pong' } }] }
            : { error: { message: `fake error ${status}` } },
        ),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    respondWith(next: number) {
      status = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
