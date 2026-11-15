import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { BackgroundContext } from '../../core/feature';
import { createOpenAiCompatibleProvider } from '../../core/llm';
import { KindedError, onMessage } from '../../core/messaging';
import { getApiKeyStatus, readApiKey, writeApiKey } from '../../core/secrets';
import { loadSettings } from '../../core/settings';
import { features } from '../../features';

const TEST_CONNECTION_TIMEOUT_MS = 20_000;

export default defineBackground(() => {
  const store = browser.storage.local;

  const getProvider: BackgroundContext['getProvider'] = async () => {
    const [settings, apiKey] = await Promise.all([
      loadSettings(store, features),
      readApiKey(store),
    ]);
    if (apiKey === null) throw new KindedError('notConfigured', '尚未设置 API key');
    const { apiBaseUrl, model } = settings.core;
    if (model === undefined) throw new KindedError('notConfigured', '尚未设置模型名');
    return {
      provider: createOpenAiCompatibleProvider({ baseUrl: apiBaseUrl, apiKey, model }),
      model,
    };
  };

  onMessage('secrets.setApiKey', ({ apiKey }) => writeApiKey(store, apiKey));
  onMessage('secrets.getApiKeyStatus', () => getApiKeyStatus(store));
  onMessage('llm.testConnection', async () => {
    const { provider, model } = await getProvider();
    await provider.complete(
      [{ role: 'user', content: 'ping' }],
      AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
    );
    return { model };
  });

  const ctx: BackgroundContext = { onMessage, getProvider };
  for (const feature of features) feature.background?.(ctx);
});
