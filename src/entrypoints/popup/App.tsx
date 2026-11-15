import { browser } from 'wxt/browser';

export function App() {
  const { name, version } = browser.runtime.getManifest();
  return (
    <main className="w-64 space-y-3 p-4 text-sm text-gray-900">
      <div className="flex items-baseline justify-between">
        <h1 className="font-semibold text-base">{name}</h1>
        <span className="text-gray-500">版本 {version}</span>
      </div>
      <button
        type="button"
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        onClick={() => void browser.runtime.openOptionsPage()}
      >
        打开设置
      </button>
    </main>
  );
}
