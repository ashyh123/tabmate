import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { browser } from 'wxt/browser';
import type { MessageName, Req } from '../../src/core/messaging';
import { expect, test } from './fixtures';

// evaluate 中的代码运行在扩展页面或 service worker 里，那里有全局的 chrome。
declare const chrome: typeof browser;

// 假密钥，只用于测试。
const API_KEY = 'sk-test-e2e-0123456789abcdefWXYZ';
const MASK = 'sk-…WXYZ';
const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
) as { version: string };

async function openOptions(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByLabel('API 地址')).toBeVisible();
}

async function fillAndSave(page: Page, baseUrl: string) {
  await page.getByLabel('API 地址').fill(baseUrl);
  await page.getByLabel('API key').fill(API_KEY);
  await page.getByLabel('模型名').fill('test-model');
  await page.getByLabel('目标语言').fill('ja');
  await page.getByLabel('默认显示模式').selectOption({ label: '替换（只显示译文）' });
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
}

/** 页面 DOM 中能看到的一切：HTML 和每个输入框的当前值（输入框的值不在 HTML 里）。 */
async function everythingInDom(page: Page): Promise<string> {
  return page.evaluate(() =>
    [
      document.documentElement.outerHTML,
      ...Array.from(document.querySelectorAll('input, select, textarea'), (el) =>
        String((el as HTMLInputElement).value),
      ),
    ].join('\n'),
  );
}

test('设置保存后重新打开仍在，key 只显示掩码，页面拿不到完整的 key', async ({
  context,
  extensionId,
  serviceWorker,
  llm,
}) => {
  const page = await context.newPage();
  await openOptions(page, extensionId);
  await fillAndSave(page, llm.baseUrl);
  await page.close();

  const reopened = await context.newPage();
  await openOptions(reopened, extensionId);
  await expect(reopened.getByLabel('API 地址')).toHaveValue(llm.baseUrl);
  await expect(reopened.getByLabel('模型名')).toHaveValue('test-model');
  await expect(reopened.getByLabel('目标语言')).toHaveValue('ja');
  await expect(reopened.getByLabel('默认显示模式')).toHaveValue('replace');
  await expect(reopened.getByLabel('API key')).toHaveValue('');
  await expect(reopened.getByText(`已设置：${MASK}`)).toBeVisible();

  // key 确实保存了（在后台的存储里），所以下面「页面里没有」的断言是有意义的。
  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(stored)).toContain(API_KEY);

  // DOM 中没有完整的 key。
  expect(await everythingInDom(reopened)).not.toContain(API_KEY);

  // 设置页读取设置时读到的存储内容中没有完整的 key。
  const settingsRead = await reopened.evaluate(() => chrome.storage.local.get('settings'));
  expect(settingsRead).toHaveProperty('settings');
  expect(JSON.stringify(settingsRead)).not.toContain(API_KEY);

  // 协议中的每一条消息，响应里都没有完整的 key。新增消息时这里会因类型不完整而无法通过类型检查。
  const everyMessage = {
    'secrets.setApiKey': { apiKey: API_KEY },
    'secrets.getApiKeyStatus': {},
    'llm.testConnection': {},
  } satisfies { [N in MessageName]: Req<N> };
  for (const [name, req] of Object.entries(everyMessage)) {
    const response = await reopened.evaluate(
      ([n, r]) => chrome.runtime.sendMessage({ name: n, req: r }),
      [name, req] as const,
    );
    expect(response, name).toHaveProperty('ok', true);
    expect(JSON.stringify(response), name).not.toContain(API_KEY);
  }
});

test('测试连接成功，请求带正确的 Authorization 头和模型名', async ({
  context,
  extensionId,
  llm,
}) => {
  const page = await context.newPage();
  await openOptions(page, extensionId);
  await fillAndSave(page, llm.baseUrl);

  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('连接成功（模型 test-model）')).toBeVisible();

  expect(llm.requests).toHaveLength(1);
  const [request] = llm.requests;
  expect(request?.method).toBe('POST');
  expect(request?.path).toBe('/v1/chat/completions');
  expect(request?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  expect(request?.body).toMatchObject({ model: 'test-model' });
});

test('假服务返回 401 时显示密钥无效', async ({ context, extensionId, llm }) => {
  const page = await context.newPage();
  await openOptions(page, extensionId);
  await fillAndSave(page, llm.baseUrl);

  llm.respondWith(401);
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('连接失败：API key 无效或没有权限（HTTP 401）')).toBeVisible();
  expect(await everythingInDom(page)).not.toContain(API_KEY);
});

test('弹出面板显示名称和版本，「打开设置」打开设置页', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('heading', { name: 'tabmate' })).toBeVisible();
  await expect(popup.getByText(`版本 ${version}`)).toBeVisible();

  const [options] = await Promise.all([
    context.waitForEvent('page'),
    popup.getByRole('button', { name: '打开设置' }).click(),
  ]);
  await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole('heading', { name: 'tabmate 设置' })).toBeVisible();
});
