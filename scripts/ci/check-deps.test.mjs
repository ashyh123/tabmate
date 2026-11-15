import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkDeps, checkRepoDeps, findImports } from './check-deps.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 一个合规的最小骨架，各违规样例在它的基础上改一个文件。 */
const baseline = {
  'src/core/messaging/index.ts': 'export const send = () => {};\n',
  'src/core/feature/index.ts': "import type { send } from '../messaging';\n",
  'src/core/settings/index.ts':
    "import { z } from 'zod';\nimport type { Feature } from '../feature';\n",
  'src/core/secrets/index.ts': "import { send } from '../messaging';\nimport './helpers';\n",
  'src/core/secrets/helpers.ts': "import { readApiKey } from './index';\n",
  'src/core/llm/index.ts': "import type { Provider } from '../feature';\n",
  'src/features/translate/index.ts':
    "import { defineFeature } from '../../core/feature';\nimport { x } from './util';\n",
  'src/features/translate/util.ts': 'export const x = 1;\n',
  'src/features/notion/index.ts': "import { defineFeature } from '@/core/feature';\n",
  'src/features/index.ts':
    "import { translate } from './translate';\nimport { notion } from './notion';\n",
  'src/entrypoints/background/index.ts': [
    "import { readApiKey } from '../../core/secrets';",
    "import { createProvider } from '@/core/llm';",
    "import { features } from '../../features';",
  ].join('\n'),
  'src/entrypoints/options/App.tsx': [
    "import { loadSettings } from '../../core/settings';",
    "import { sendMessage } from '~/core/messaging';",
    "import { features } from '@/features';",
  ].join('\n'),
};

const check = (overrides) => checkDeps(new Map(Object.entries({ ...baseline, ...overrides })));

test('合规的骨架没有违规', () => {
  assert.deepEqual(check({}), []);
});

test('规则一：一个功能引用另一个功能时失败', () => {
  const violations = check({
    'src/features/notion/index.ts': "import { x } from '../translate/util';\n",
  });
  assert.equal(violations.length, 1);
  assert.match(
    violations[0],
    /src\/features\/notion\/index\.ts 引用了另一个功能 src\/features\/translate\/util\.ts/,
  );
});

test('规则一：通过别名引用另一个功能同样失败', () => {
  const violations = check({
    'src/features/notion/index.ts': "export { translateFeature } from '@/features/translate';\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /另一个功能/);
});

test('规则二：core 引用 features 下的功能时失败', () => {
  const violations = check({
    'src/core/feature/index.ts': "import { translate } from '../../features/translate';\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /core 不得引用 features/);
});

test('规则二：core 引用功能清单文件同样失败', () => {
  const violations = check({
    'src/core/settings/index.ts': "import { features } from '@/features';\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /src\/features\/index\.ts（core 不得引用 features）/);
});

test('规则三：设置页引用 core/secrets 时失败', () => {
  const violations = check({
    'src/entrypoints/options/App.tsx': "import { readApiKey } from '../../core/secrets';\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /src\/core\/secrets 只能被后台入口引用/);
});

test('规则三：弹出面板引用 core/llm 时失败，类型导入也算', () => {
  const violations = check({
    'src/entrypoints/popup/App.tsx': "import type { LlmError } from '@/core/llm';\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /src\/core\/llm 只能被后台入口引用/);
});

test('规则三：功能模块和其他内核模块引用 core/llm 时失败', () => {
  const violations = check({
    'src/features/translate/index.ts': "import { createProvider } from '../../core/llm';\n",
    'src/core/secrets/index.ts': "import { LlmError } from '../llm';\n",
  });
  assert.equal(violations.length, 2);
  for (const violation of violations) assert.match(violation, /src\/core\/llm 只能被后台入口引用/);
});

test('规则三：动态 import 和 re-export 同样被检查', () => {
  const violations = check({
    'src/entrypoints/options/lazy.ts': "const m = await import('../../core/secrets');\n",
    'src/entrypoints/popup/reexport.ts': "export * from '../../core/llm/index.ts';\n",
  });
  assert.equal(violations.length, 2);
});

test('参数不是字符串字面量的动态 import 报错', () => {
  const violations = check({
    'src/entrypoints/options/lazy.ts':
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 这是被扫描的源码文本，${} 是有意写进去的
      "const name = 'secrets';\nawait import(`../../core/${name}`);\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /无法检查/);
});

test('注释和字符串里的 import 不算引用', () => {
  const source = [
    "// import { readApiKey } from '../../core/secrets';",
    "/* import '../../core/llm'; */",
    'const doc = "import x from \'../../core/secrets\'";',
    "const url = 'https://api.openai.com/v1'; import { a } from './a';",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 这是被扫描的源码文本，${} 是有意写进去的
    'const re = /["\']/g; const t = `import(${"../../core/llm"})`;',
    "export const label = <p>it's fine</p>;",
    "import { b } from './b';",
  ].join('\n');
  assert.deepEqual(findImports(source).specifiers, ['./a', './b']);
});

test('仓库当前的 src/ 通过检查', () => {
  const { checked, violations } = checkRepoDeps(repoRoot);
  assert.ok(checked > 0, '没有找到任何源文件');
  assert.deepEqual(violations, []);
});
