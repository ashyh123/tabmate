import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, test as base, chromium, type Worker } from '@playwright/test';
import { startFakeLlmServer } from './fake-llm-server';

const extensionPath = resolve(import.meta.dirname, '../../.output/chrome-mv3');

/**
 * 加载构建产物的 Chromium。扩展只能在持久化上下文中加载；
 * channel 'chromium' 使用 Playwright 自带的完整 Chromium（新 headless 模式），无界面环境（CI）中也能加载扩展。
 */
export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  llm: Awaited<ReturnType<typeof startFakeLlmServer>>;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture 约定的写法
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'tabmate-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? (await context.waitForEvent('serviceworker')));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture 约定的写法
  llm: async ({}, use) => {
    const server = await startFakeLlmServer();
    await use(server);
    await server.close();
  },
});

export { expect } from '@playwright/test';
