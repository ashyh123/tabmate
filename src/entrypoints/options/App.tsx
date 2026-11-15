import { type ReactNode, useEffect, useId, useState } from 'react';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { FeatureSettingField } from '../../core/feature';
import { type ApiKeyStatus, sendMessage } from '../../core/messaging';
import {
  loadSettings,
  type Settings,
  SettingsValidationError,
  saveSettings,
} from '../../core/settings';
import { features } from '../../features';

const store = browser.storage.local;

interface Form {
  core: { apiBaseUrl: string; model: string };
  features: Record<string, Record<string, string>>;
}

type Notice = { tone: 'ok' | 'error' | 'info'; text: string } | null;

function toForm(settings: Settings): Form {
  return {
    core: { apiBaseUrl: settings.core.apiBaseUrl, model: settings.core.model ?? '' },
    features: settings.features,
  };
}

export function App() {
  const [form, setForm] = useState<Form | null>(null);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveNotice, setSaveNotice] = useState<Notice>(null);
  const [testNotice, setTestNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<'saving' | 'testing' | null>(null);

  useEffect(() => {
    void loadSettings(store, features).then((settings) => setForm(toForm(settings)));
    void sendMessage('secrets.getApiKeyStatus', {}).then((result) => {
      if (result.ok) setKeyStatus(result.data);
    });
  }, []);

  if (form === null) return <p className="p-8 text-gray-500 text-sm">正在加载…</p>;

  const setCore = (field: keyof Form['core'], value: string) =>
    setForm({ ...form, core: { ...form.core, [field]: value } });
  const setFeatureField = (featureId: string, field: string, value: string) =>
    setForm({
      ...form,
      features: { ...form.features, [featureId]: { ...form.features[featureId], [field]: value } },
    });

  async function save() {
    if (form === null) return;
    setBusy('saving');
    setSaveNotice(null);
    setFieldErrors({});
    try {
      const saved = await saveSettings(store, features, form);
      setForm(toForm(saved));
      if (apiKeyInput.trim() !== '') {
        const result = await sendMessage('secrets.setApiKey', { apiKey: apiKeyInput });
        if (!result.ok) {
          setFieldErrors({ apiKey: result.error.message });
          setSaveNotice({ tone: 'error', text: '其他设置已保存，API key 未保存' });
          return;
        }
        setKeyStatus(result.data);
        setApiKeyInput('');
      }
      setSaveNotice({ tone: 'ok', text: '已保存' });
    } catch (error) {
      if (error instanceof SettingsValidationError) {
        setFieldErrors(error.fieldErrors);
        setSaveNotice({ tone: 'error', text: '有字段填写不正确，未保存' });
      } else {
        setSaveNotice({ tone: 'error', text: `保存失败：${String(error)}` });
      }
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy('testing');
    setTestNotice({ tone: 'info', text: '正在测试…' });
    const result = await sendMessage('llm.testConnection', {});
    setTestNotice(
      result.ok
        ? { tone: 'ok', text: `连接成功（模型 ${result.data.model}）` }
        : { tone: 'error', text: `连接失败：${result.error.message}` },
    );
    setBusy(null);
  }

  return (
    <main className="mx-auto max-w-xl space-y-8 p-8 text-gray-900 text-sm">
      <h1 className="font-semibold text-xl">tabmate 设置</h1>

      <Section title="模型接口">
        <TextField
          label="API 地址"
          value={form.core.apiBaseUrl}
          error={fieldErrors['core.apiBaseUrl']}
          onChange={(value) => setCore('apiBaseUrl', value)}
        />
        <TextField
          label="API key"
          type="password"
          value={apiKeyInput}
          placeholder={keyStatus?.isSet ? '留空表示不修改' : '例如 sk-…'}
          hint={keyStatus?.isSet ? `已设置：${keyStatus.mask}` : '未设置'}
          error={fieldErrors.apiKey}
          onChange={setApiKeyInput}
        />
        <TextField
          label="模型名"
          value={form.core.model}
          error={fieldErrors['core.model']}
          onChange={(value) => setCore('model', value)}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void testConnection()}
          >
            测试连接
          </button>
          <span className="text-gray-500 text-xs">使用已保存的设置</span>
        </div>
        <NoticeText notice={testNotice} />
      </Section>

      {features.map((feature) => (
        <Section key={feature.id} title={feature.name}>
          {Object.entries(feature.settings.shape).map(([field, schema]) => (
            <FeatureField
              key={field}
              schema={schema}
              value={form.features[feature.id]?.[field] ?? ''}
              error={fieldErrors[`features.${feature.id}.${field}`]}
              onChange={(value) => setFeatureField(feature.id, field, value)}
            />
          ))}
        </Section>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-gray-900 px-4 py-1.5 text-white hover:bg-gray-700 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void save()}
        >
          保存
        </button>
        <NoticeText notice={saveNotice} />
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-gray-200 p-5">
      <h2 className="font-medium text-base">{title}</h2>
      {children}
    </section>
  );
}

const noticeColor = { ok: 'text-green-700', error: 'text-red-700', info: 'text-gray-500' };

function NoticeText({ notice }: { notice: Notice }) {
  return (
    <p role="status" className={notice ? noticeColor[notice.tone] : undefined}>
      {notice?.text}
    </p>
  );
}

interface FieldProps {
  label: string;
  value: string;
  error?: string | undefined;
  hint?: string | undefined;
  onChange(value: string): void;
}

function FieldShell({
  label,
  error,
  hint,
  children,
}: Omit<FieldProps, 'value' | 'onChange'> & { children(id: string): ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-gray-500 text-xs">{hint}</p>}
      {error && <p className="text-red-700 text-xs">{error}</p>}
    </div>
  );
}

const inputClass = 'w-full rounded-md border border-gray-300 px-2 py-1.5';

function TextField({
  type = 'text',
  placeholder,
  ...props
}: FieldProps & { type?: 'text' | 'password'; placeholder?: string }) {
  return (
    <FieldShell {...props}>
      {(id) => (
        <input
          id={id}
          type={type}
          className={inputClass}
          value={props.value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

function FeatureField({
  schema,
  ...props
}: Omit<FieldProps, 'label'> & { schema: FeatureSettingField }) {
  const meta = schema.meta() ?? {};
  const label = meta.title ?? '';
  const inner = schema.unwrap();
  if (!(inner instanceof z.ZodEnum)) {
    return <TextField {...props} label={label} hint={meta.description} />;
  }
  return (
    <FieldShell {...props} label={label} hint={meta.description}>
      {(id) => (
        <select
          id={id}
          className={inputClass}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {inner.options.map((option) => (
            <option key={option} value={option}>
              {meta.optionLabels?.[option] ?? option}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}
